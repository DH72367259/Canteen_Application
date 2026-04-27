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
    { data: paymentsRaw },
    { data: canteenRow },
  ] = await Promise.all([
    supabase
      .from("orders")
      .select("id, total_amount, status, created_at, items, payment_id")
      .eq("canteen_id", targetCanteenId)
      .gte("created_at", period_start + "T00:00:00Z")
      .lte("created_at", period_end   + "T23:59:59Z")
      .order("created_at", { ascending: false }),
    supabase.from("platform_charges").select("*").limit(1),
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

  const orders = (ordersRaw ?? []).map(o => {
    const gross      = Number(o.total_amount);
    const rawFee     = gross * (chargePct / 100) + flatCharge;
    const gstOnFee   = rawFee * (gstPct / 100);
    const platform   = rawFee + gstOnFee;
    const net        = Math.max(0, gross - platform);
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
      total_platform_charge: r2(platform),
      net_earnings: r2(net),
      is_completed: o.status === "collected",
    };
  });

  const completed = orders.filter(o => o.is_completed);
  const summary = {
    total_orders:            orders.length,
    completed_orders:        completed.length,
    gross_collected:         r2(completed.reduce((s, o) => s + o.gross_amount, 0)),
    total_platform_charges:  r2(completed.reduce((s, o) => s + o.total_platform_charge, 0)),
    total_platform_fee:      r2(completed.reduce((s, o) => s + o.platform_fee, 0)),
    total_gst:               r2(completed.reduce((s, o) => s + o.gst_on_fee, 0)),
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
