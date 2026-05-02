/**
 * GET /api/admin/settlements/weekly-report
 *
 * Returns week-over-week settlement breakdown for the last N weeks.
 * Query params: weeks (default 8)
 *
 * Each week: { week_start, week_end, gross, platform_fee, gst, net_payable,
 *              amount_paid, amount_pending, order_count, completed_orders }
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

/** Returns Monday of the ISO week containing `d` (in UTC). */
function weekStart(d: Date): Date {
  const day = d.getUTCDay(); // 0=Sun … 6=Sat
  const diff = (day === 0 ? -6 : 1 - day);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
}

export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx || ctx.role !== "super_admin")
    return Response.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const numWeeks = Math.min(52, Math.max(1, Number(searchParams.get("weeks") ?? 8)));

  const supabase = createAdminClient();

  // Build week boundaries (latest first)
  const now = new Date();
  const thisMonday = weekStart(now);
  const weeks: Array<{ start: string; end: string }> = [];
  for (let i = numWeeks - 1; i >= 0; i--) {
    const wStart = new Date(thisMonday.getTime() - i * 7 * 24 * 60 * 60 * 1000);
    const wEnd   = new Date(wStart.getTime() + 6 * 24 * 60 * 60 * 1000);
    weeks.push({
      start: wStart.toISOString().slice(0, 10),
      end:   wEnd.toISOString().slice(0, 10),
    });
  }

  const overallStart = weeks[0].start;
  const overallEnd   = weeks[weeks.length - 1].end;

  // Fetch all relevant data in parallel
  const [
    { data: orders },
    { data: payments },
    { data: paymentLedger },
    { data: chargesRows },
  ] = await Promise.all([
    supabase
      .from("orders")
      .select("id, canteen_id, user_id, payment_id, total_amount, status, created_at, extra_bin_fee_paise")
      .gte("created_at", overallStart + "T00:00:00Z")
      .lte("created_at", overallEnd   + "T23:59:59Z"),
    supabase
      .from("settlement_payments")
      .select("canteen_id, amount_paid, period_start, period_end, created_at")
      .gte("period_start", overallStart)
      .lte("period_end",   overallEnd),
    supabase
      .from("payments")
      .select("order_id, charge_pct_snapshot, flat_charge_snapshot, gst_pct_snapshot, status")
      .gte("captured_at", overallStart + "T00:00:00Z")
      .lte("captured_at", overallEnd   + "T23:59:59Z"),
    supabase.from("platform_charges").select("*").limit(1),
  ]);

  const charges   = chargesRows?.[0];
  const chargePct  = Number(charges?.charge_pct  ?? 2.0);
  const flatCharge = Number(charges?.flat_charge ?? 0.0);
  const gstPct     = Number(charges?.gst_pct     ?? 18.0);
  const orderIds = (orders ?? []).map((order) => order.id);
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

  const paymentsByOrder = new Map((paymentLedger ?? []).map((p: {
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

  const report = weeks.map(w => {
    const weekOrders = (orders ?? []).filter(o => {
      const d = o.created_at.slice(0, 10);
      return d >= w.start && d <= w.end;
    });
    const completed = weekOrders.filter(o => o.status === "collected");

    const chargeRows = completed.map(o => {
      const extraBin = r2((Number((o as { extra_bin_fee_paise?: number | null }).extra_bin_fee_paise ?? 0) || 0) / 100);
      const gross = r2(foodGrossByOrder.get(o.id) ?? Math.max(0, Number(o.total_amount) - extraBin));
      const payment = paymentsByOrder.get(o.id);
      const pct = Number(payment?.charge_pct_snapshot ?? chargePct);
      const flat = Number(payment?.flat_charge_snapshot ?? flatCharge);
      const gstPctSnapshot = Number(payment?.gst_pct_snapshot ?? gstPct);
      const platformFee = r2(gross * (pct / 100) + flat);
      const gstFee = r2(platformFee * (gstPctSnapshot / 100));
      const subscriptionFromThisPayment = o.payment_id ? subscriptionsByPayment.get(o.payment_id) : undefined;
      const proRevenue = r2(Number(subscriptionFromThisPayment?.amount_paid ?? 0));
      const userSubscriptions = subscriptionsByUser.get((o as { user_id?: string | null }).user_id ?? "") ?? [];
      const convenience = subscriptionFromThisPayment || hasActiveProAt(userSubscriptions, o.created_at) ? 0 : 4;
      const deductedFromOrder = platformFee + gstFee;
      const totalAdmin = deductedFromOrder + extraBin + convenience + proRevenue;
      const net = r2(Math.max(0, gross - deductedFromOrder));
      return { gross, platformFee, gstFee, extraBin, convenience, proRevenue, deductedFromOrder, totalAdmin, net };
    });

    const gross = chargeRows.reduce((s, r) => s + r.gross, 0);
    const rawFee = chargeRows.reduce((s, r) => s + r.platformFee, 0);
    const gstFee = chargeRows.reduce((s, r) => s + r.gstFee, 0);
    const extraBinFee = chargeRows.reduce((s, r) => s + r.extraBin, 0);
    const convenienceAndOtherFee = chargeRows.reduce((s, r) => s + r.convenience, 0);
    const proRevenue = chargeRows.reduce((s, r) => s + r.proRevenue, 0);
    const totalFee = chargeRows.reduce((s, r) => s + r.deductedFromOrder, 0);
    const totalAdmin = chargeRows.reduce((s, r) => s + r.totalAdmin, 0);
    const net = chargeRows.reduce((s, r) => s + r.net, 0);

    // Payments made where the period overlaps this week
    const weekPayments = (payments ?? []).filter(p => {
      // include if created_at falls in this week
      const d = (p.created_at ?? p.period_start ?? "").slice(0, 10);
      return d >= w.start && d <= w.end;
    });
    const paid = weekPayments.reduce((s, p) => s + Number(p.amount_paid), 0);

    return {
      week_start:       w.start,
      week_end:         w.end,
      total_orders:     weekOrders.length,
      completed_orders: completed.length,
      gross:            r2(gross),
      platform_fee:     r2(rawFee),
      gst_on_fee:       r2(gstFee),
      extra_bin_charge: r2(extraBinFee),
      convenience_and_other_charge: r2(convenienceAndOtherFee),
      pro_revenue:      r2(proRevenue),
      total_platform_earnings: r2(totalFee),
      total_admin_earnings: r2(totalAdmin),
      net_payable:      r2(net),
      amount_paid:      r2(paid),
      amount_pending:   r2(Math.max(0, net - paid)),
    };
  });

  // Totals across all weeks
  const totals = {
    gross:                   r2(report.reduce((s, w) => s + w.gross, 0)),
    platform_fee:            r2(report.reduce((s, w) => s + w.platform_fee, 0)),
    gst_on_fee:              r2(report.reduce((s, w) => s + w.gst_on_fee, 0)),
    extra_bin_charge:        r2(report.reduce((s, w) => s + w.extra_bin_charge, 0)),
    convenience_and_other_charge: r2(report.reduce((s, w) => s + w.convenience_and_other_charge, 0)),
    pro_revenue:             r2(report.reduce((s, w) => s + w.pro_revenue, 0)),
    total_platform_earnings: r2(report.reduce((s, w) => s + w.total_platform_earnings, 0)),
    total_admin_earnings:    r2(report.reduce((s, w) => s + w.total_admin_earnings, 0)),
    net_payable:             r2(report.reduce((s, w) => s + w.net_payable, 0)),
    amount_paid:             r2(report.reduce((s, w) => s + w.amount_paid, 0)),
    amount_pending:          r2(report.reduce((s, w) => s + w.amount_pending, 0)),
    total_orders:             report.reduce((s, w) => s + w.total_orders, 0),
    completed_orders:         report.reduce((s, w) => s + w.completed_orders, 0),
  };

  return Response.json({ weeks: report, totals, platform_charges: { chargePct, flatCharge, gstPct } });
}
