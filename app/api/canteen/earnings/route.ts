/**
 * GET /api/canteen/earnings
 *
 * Returns per-transaction earnings detail + period summary for the calling
 * canteen_admin or vendor. Each order shows gross, platform fee breakdown, and net.
 *
 * Query params:
 *   period_start (YYYY-MM-DD)  — default: 30 days ago
 *   period_end   (YYYY-MM-DD)  — default: today
 */
import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

function r2(n: number) { return Math.round(n * 100) / 100; }

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
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const allowedRoles = ["canteen_admin", "vendor", "super_admin", "co_admin"];
  if (!allowedRoles.includes(ctx.role ?? ""))
    return Response.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const now = new Date();
  const defaultStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const defaultEnd   = now.toISOString().slice(0, 10);
  const period_start = searchParams.get("period_start") || defaultStart;
  const period_end   = searchParams.get("period_end")   || defaultEnd;

  const supabase = createAdminClient();

  // Resolve canteen_id from the user's profile
  const { data: profile } = await supabase
    .from("profiles")
    .select("canteen_id")
    .eq("id", ctx.uid)
    .single();

  const canteen_id = profile?.canteen_id;

  // super_admin can pass explicit canteen_id param
  const targetCanteenId = ctx.role === "super_admin" || ctx.role === "co_admin"
    ? (searchParams.get("canteen_id") || canteen_id)
    : canteen_id;

  if (!targetCanteenId)
    return Response.json({ error: "No canteen associated with this account." }, { status: 404 });

  // Load in parallel
  const [
    { data: ordersRaw },
    { data: chargesRows },
    { data: paymentsRawLedger },
    { data: paymentsRaw },
    { data: canteenRow },
  ] = await Promise.all([
    supabase
      .from("orders")
      .select("id, user_id, total_amount, status, created_at, payment_id, extra_bin_fee_paise")
      .eq("canteen_id", targetCanteenId)
      .gte("created_at", period_start + "T00:00:00Z")
      .lte("created_at", period_end   + "T23:59:59Z")
      .order("created_at", { ascending: false }),
    supabase.from("platform_charges").select("*").limit(1),
    supabase
      .from("payments")
      .select("order_id, charge_pct_snapshot, flat_charge_snapshot, gst_pct_snapshot, status")
      .eq("canteen_id", targetCanteenId),
    supabase
      .from("settlement_payments")
      .select("id, amount_paid, payment_mode, transaction_ref, notes, created_at, period_start, period_end")
      .eq("canteen_id", targetCanteenId)
      .order("created_at", { ascending: false }),
    supabase.from("canteens").select("id, name, city, college").eq("id", targetCanteenId).single(),
  ]);

  const charges   = chargesRows?.[0];
  const chargePct  = Number(charges?.charge_pct  ?? 2.0);
  const flatCharge = Number(charges?.flat_charge ?? 0.0);
  const gstPct     = Number(charges?.gst_pct     ?? 18.0);
  const orderIds = (ordersRaw ?? []).map((order) => order.id);
  const [
    { data: orderItems },
    { data: subscriptionsRows },
  ] = await Promise.all([
    orderIds.length > 0
      ? supabase.from("order_items").select("order_id, quantity, unit_price").in("order_id", orderIds)
      : Promise.resolve({ data: [] as Array<{ order_id: string; quantity: number | null; unit_price: number | null }> }),
    supabase.from("noqx_pro_subscriptions").select("user_id, payment_id, amount_paid, started_at, expires_at, status"),
  ]);

  const foodGrossByOrder = new Map<string, number>();
  for (const row of orderItems ?? []) {
    const lineTotal = Number(row.quantity ?? 0) * Number(row.unit_price ?? 0);
    foodGrossByOrder.set(row.order_id, (foodGrossByOrder.get(row.order_id) ?? 0) + lineTotal);
  }

  const paymentsByOrder = new Map((paymentsRawLedger ?? []).map((p: {
    order_id: string | null;
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

  const orders = (ordersRaw ?? []).map(o => {
    const extraBin = r2((Number((o as { extra_bin_fee_paise?: number | null }).extra_bin_fee_paise ?? 0) || 0) / 100);
    const gross = r2(foodGrossByOrder.get(o.id) ?? Math.max(0, Number(o.total_amount) - extraBin));
    const payment = paymentsByOrder.get(o.id);
    const pct = Number(payment?.charge_pct_snapshot ?? chargePct);
    const flat = Number(payment?.flat_charge_snapshot ?? flatCharge);
    const gstPctSnapshot = Number(payment?.gst_pct_snapshot ?? gstPct);
    const rawFee = r2(gross * (pct / 100) + flat);
    const gstOnFee = r2(rawFee * (gstPctSnapshot / 100));
    const subscriptionFromThisPayment = o.payment_id ? subscriptionsByPayment.get(o.payment_id) : undefined;
    const userSubscriptions = subscriptionsByUser.get((o as { user_id?: string | null }).user_id ?? "") ?? [];
    const convenienceAndOther = subscriptionFromThisPayment || hasActiveProAt(userSubscriptions, o.created_at) ? 0 : 4;
    const totalDeductedFromOrder = rawFee + gstOnFee;
    const net = r2(Math.max(0, gross - totalDeductedFromOrder));
    return {
      order_id:     o.id,
      order_ref:    o.id.substring(0, 8).toUpperCase(),
      status:       o.status,
      created_at:   o.created_at,
      gross_amount: r2(gross),
      charge_pct:   chargePct,
      flat_charge:  flatCharge,
      platform_fee: r2(rawFee),
      gst_on_fee:   r2(gstOnFee),
      extra_bin_charge: r2(extraBin),
      convenience_and_other_charge: r2(convenienceAndOther),
      total_platform_charge: r2(totalDeductedFromOrder),
      total_admin_earnings: r2(totalDeductedFromOrder + extraBin + convenienceAndOther),
      net_earnings: r2(net),
      is_completed: o.status === "collected",
    };
  });

  // Money lands in the platform account at payment time, so any non-cancelled
  // order contributes to gross collected. OTP verification (status=collected)
  // is just the fulfilment receipt and does not affect what the canteen has
  // earned. We still surface a separate "awaiting collection" count for ops.
  const completed = orders.filter(o => o.status !== "cancelled");
  const adminExtraBin = completed.reduce((s, o) => s + o.extra_bin_charge, 0);
  const adminConvenience = completed.reduce((s, o) => s + o.convenience_and_other_charge, 0);
  const summary = {
    total_orders:            orders.length,
    completed_orders:        completed.length,
    awaiting_collection:     orders.filter(o => !["collected", "cancelled"].includes(o.status)).length,
    gross_collected:         r2(completed.reduce((s, o) => s + o.gross_amount, 0)),
    total_platform_charges:  r2(completed.reduce((s, o) => s + o.total_platform_charge, 0)),
    total_platform_fee:      r2(completed.reduce((s, o) => s + o.platform_fee, 0)),
    total_gst:               r2(completed.reduce((s, o) => s + o.gst_on_fee, 0)),
    total_extra_bin_charges: r2(adminExtraBin),
    total_convenience_and_other_charges: r2(adminConvenience),
    total_admin_earnings:    r2(completed.reduce((s, o) => s + o.total_admin_earnings, 0)),
    net_earnings:            r2(completed.reduce((s, o) => s + o.net_earnings, 0)),
    total_paid_by_admin:     r2((paymentsRaw ?? []).reduce((s, p) => s + Number(p.amount_paid), 0)),
  };
  const pending_payout = r2(Math.max(0, summary.net_earnings - summary.total_paid_by_admin));

  return Response.json({
    canteen: canteenRow,
    period_start,
    period_end,
    platform_charges: { chargePct, flatCharge, gstPct },
    summary: { ...summary, pending_payout },
    orders,
    payment_history: paymentsRaw ?? [],
  });
}
