import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

function r2(n: number) { return Math.round(n * 100) / 100; }

function isValidDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return parsed.toISOString().slice(0, 10) === value;
}

type SubscriptionRow = {
  user_id: string | null;
  payment_id: string | null;
  amount_paid: number | null;
  started_at: string | null;
  expires_at: string | null;
  status: string | null;
};

function hasActiveProAt(subscriptions: SubscriptionRow[], createdAt: string): boolean {
  const createdMs = Date.parse(createdAt);
  return subscriptions.some((subscription) => {
    if (subscription.status !== "active" || !subscription.started_at) return false;
    const startedMs = Date.parse(subscription.started_at);
    const expiryMs = subscription.expires_at ? Date.parse(subscription.expires_at) : Number.POSITIVE_INFINITY;
    return startedMs <= createdMs && createdMs <= expiryMs;
  });
}

export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
  // co_admin can view settlements (read-only); only super_admin can mutate
  // (POST handlers in /pay and /payout still gate on super_admin).
  if (!ctx || (ctx.role !== "super_admin" && ctx.role !== "co_admin")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const now = new Date();
  // Default period: last 30 days
  const defaultStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const defaultEnd   = now.toISOString().split("T")[0];
  const period_start = searchParams.get("period_start") || defaultStart;
  const period_end   = searchParams.get("period_end")   || defaultEnd;

  if (!isValidDateOnly(period_start) || !isValidDateOnly(period_end)) {
    return Response.json({ error: "Invalid period_start or period_end. Use YYYY-MM-DD." }, { status: 400 });
  }

  if (period_start > period_end) {
    return Response.json({ error: "period_start must be on or before period_end." }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Fetch all active canteens, orders in period, platform charges, payments made, bank details
  const [
    { data: canteens },
    { data: orders },
    { data: chargesRows },
    { data: paymentLedger },
    { data: payments },
    { data: bankDetails },
  ] = await Promise.all([
    supabase.from("canteens").select("id, name, city, college").eq("is_active", true),
    supabase
      .from("orders")
      .select("id, canteen_id, user_id, total_amount, status, created_at, payment_id, extra_bin_fee_paise")
      .gte("created_at", period_start + "T00:00:00Z")
      .lte("created_at", period_end + "T23:59:59Z"),
    supabase.from("platform_charges").select("*").limit(1),
    supabase
      .from("payments")
      .select("order_id, canteen_id, charge_pct_snapshot, flat_charge_snapshot, gst_pct_snapshot, status")
      .gte("captured_at", period_start + "T00:00:00Z")
      .lte("captured_at", period_end + "T23:59:59Z"),
    supabase
      .from("settlement_payments")
      .select("*")
      .gte("period_start", period_start)
      .lte("period_end",   period_end),
    supabase.from("canteen_bank_details").select("*"),
  ]);

  const charges    = chargesRows?.[0];
  const charge_pct  = Number(charges?.charge_pct  ?? 2.0);
  const flat_charge = Number(charges?.flat_charge ?? 0.0);
  const gst_pct     = Number(charges?.gst_pct     ?? 18.0);

  const orderIds = (orders ?? []).map((order) => order.id);
  const [
    { data: orderItems },
    { data: subscriptionsRows },
  ] = await Promise.all([
    orderIds.length > 0
      ? supabase.from("order_items").select("order_id, quantity, cancelled_quantity, unit_price").in("order_id", orderIds)
      : Promise.resolve({ data: [] as Array<{ order_id: string; quantity: number | null; cancelled_quantity: number | null; unit_price: number | null }> }),
    supabase.from("noqx_pro_subscriptions").select("user_id, payment_id, amount_paid, started_at, expires_at, status"),
  ]);

  const foodGrossByOrder = new Map<string, number>();
  for (const row of orderItems ?? []) {
    const qty = Math.max(0, Number(row.quantity ?? 0) - Number(row.cancelled_quantity ?? 0));
    const lineTotal = qty * Number(row.unit_price ?? 0);
    foodGrossByOrder.set(row.order_id, (foodGrossByOrder.get(row.order_id) ?? 0) + lineTotal);
  }

  const paymentsByOrder = new Map((paymentLedger ?? []).map((p: {
    order_id: string | null;
    canteen_id: string | null;
    charge_pct_snapshot: number | null;
    flat_charge_snapshot: number | null;
    gst_pct_snapshot: number | null;
    status: string | null;
  }) => [p.order_id, p]));
  const subscriptionsByPayment = new Map((subscriptionsRows ?? []).filter((row: SubscriptionRow) => row.payment_id).map((row: SubscriptionRow) => [row.payment_id, row]));
  const subscriptionsByUser = new Map<string, SubscriptionRow[]>();
  for (const row of subscriptionsRows ?? []) {
    if (!row.user_id) continue;
    const existing = subscriptionsByUser.get(row.user_id) ?? [];
    existing.push(row as SubscriptionRow);
    subscriptionsByUser.set(row.user_id, existing);
  }

  let totalProRevenue = 0;

  const summary = (canteens ?? []).map(canteen => {
    const co = (orders ?? []).filter(o => o.canteen_id === canteen.id);
    const completed = co.filter(o => o.status === "collected");
    const cancelled  = co.filter(o => o.status === "cancelled");
    const pending    = co.filter(o => !["collected","cancelled"].includes(o.status));

    const chargeRows = completed.map(o => {
      const extraBin = r2((Number((o as { extra_bin_fee_paise?: number | null }).extra_bin_fee_paise ?? 0) || 0) / 100);
      const gross = r2(foodGrossByOrder.get(o.id) ?? Math.max(0, Number(o.total_amount) - extraBin));
      const payment = paymentsByOrder.get(o.id);
      const pct = Number(payment?.charge_pct_snapshot ?? charge_pct);
      const flat = Number(payment?.flat_charge_snapshot ?? flat_charge);
      const gstPctSnapshot = Number(payment?.gst_pct_snapshot ?? gst_pct);
      const platformFee = r2(gross * (pct / 100) + flat);
      const gst = r2(platformFee * (gstPctSnapshot / 100));
      const subscriptionFromThisPayment = o.payment_id ? subscriptionsByPayment.get(o.payment_id) : undefined;
      const proRevenue = r2(Number(subscriptionFromThisPayment?.amount_paid ?? 0));
      totalProRevenue += proRevenue;
      const userSubscriptions = subscriptionsByUser.get((o as { user_id?: string | null }).user_id ?? "") ?? [];
      const convenience = subscriptionFromThisPayment || hasActiveProAt(userSubscriptions, o.created_at) ? 0 : 4;
      const platformOrderTotal = platformFee + gst;
      const totalAdmin = platformOrderTotal + extraBin + convenience;
      // Convenience fee is charged on top of food price to the student — do NOT deduct from canteen gross
      const netToCanteen = r2(Math.max(0, gross - platformOrderTotal - extraBin));
      return {
        gross,
        platformFee,
        gst,
        extraBin,
        convenience,
        proRevenue,
        deductedFromOrder: platformOrderTotal,
        totalAdmin,
        netToCanteen,
      };
    });

    const gross_amount = chargeRows.reduce((s, r) => s + r.gross, 0);
    const platform_fee_amount = chargeRows.reduce((s, r) => s + r.platformFee, 0);
    const gst_on_charge = chargeRows.reduce((s, r) => s + r.gst, 0);
    const extra_bin_charge_amount = chargeRows.reduce((s, r) => s + r.extraBin, 0);
    const convenience_charge_amount = chargeRows.reduce((s, r) => s + r.convenience, 0);
    const platform_charge_amount = chargeRows.reduce((s, r) => s + r.deductedFromOrder, 0);
    const total_admin_earnings = chargeRows.reduce((s, r) => s + r.totalAdmin, 0);
    const net_payable  = Math.max(0, chargeRows.reduce((s, r) => s + r.netToCanteen, 0));

    const cp         = (payments ?? []).filter(p => p.canteen_id === canteen.id);
    const amount_paid = cp.reduce((s, p) => s + Number(p.amount_paid), 0);
    const amount_remaining = Math.max(0, net_payable - amount_paid);

    const bank = (bankDetails ?? []).find(b => b.canteen_id === canteen.id) ?? null;

    return {
      canteen_id:              canteen.id,
      canteen_name:            canteen.name,
      city:                    canteen.city,
      college:                 canteen.college,
      total_orders:            co.length,
      completed_orders:        completed.length,
      cancelled_orders:        cancelled.length,
      pending_orders:          pending.length,
      gross_amount:            r2(gross_amount),
      charge_pct,
      flat_charge,
      platform_fee_amount:     r2(platform_fee_amount),
      platform_charge_amount:  r2(platform_charge_amount),
      gst_on_charge:           r2(gst_on_charge),
      extra_bin_charge_amount: r2(extra_bin_charge_amount),
      convenience_charge_amount: r2(convenience_charge_amount),
      total_admin_earnings:    r2(total_admin_earnings),
      net_payable:             r2(net_payable),
      amount_paid:             r2(amount_paid),
      amount_remaining:        r2(amount_remaining),
      payment_status:          amount_remaining <= 0 && net_payable > 0 ? "paid"
                                 : amount_paid > 0 ? "partial" : "pending",
      payments:                cp,
      bank_details:            bank,
    };
  });

  const ss = summary;
  return Response.json({
    period_start,
    period_end,
    platform_charges:  { charge_pct, flat_charge, gst_pct, id: charges?.id },
    summary_stats: {
      total_collected:         r2(ss.reduce((a, c) => a + c.gross_amount, 0)),
      total_platform_fees:     r2(ss.reduce((a, c) => a + c.platform_fee_amount, 0)),
      total_gst_on_fees:       r2(ss.reduce((a, c) => a + c.gst_on_charge, 0)),
      total_extra_bin_charges: r2(ss.reduce((a, c) => a + c.extra_bin_charge_amount, 0)),
      total_convenience_and_other_charges: r2(ss.reduce((a, c) => a + c.convenience_charge_amount, 0)),
      total_platform_earnings: r2(ss.reduce((a, c) => a + c.platform_charge_amount, 0)),
      total_pro_revenue:       r2(totalProRevenue),
      total_admin_earnings:    r2(ss.reduce((a, c) => a + c.total_admin_earnings, 0) + totalProRevenue),
      total_net_payable:       r2(ss.reduce((a, c) => a + c.net_payable, 0)),
      total_paid:              r2(ss.reduce((a, c) => a + c.amount_paid, 0)),
      total_remaining:         r2(ss.reduce((a, c) => a + c.amount_remaining, 0)),
      total_orders:            ss.reduce((a, c) => a + c.total_orders, 0),
      total_completed:         ss.reduce((a, c) => a + c.completed_orders, 0),
      total_cancelled:         ss.reduce((a, c) => a + c.cancelled_orders, 0),
    },
    canteens: summary,
  });
}
