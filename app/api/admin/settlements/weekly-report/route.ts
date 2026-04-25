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
    { data: chargesRows },
  ] = await Promise.all([
    supabase
      .from("orders")
      .select("id, canteen_id, total_amount, status, created_at")
      .gte("created_at", overallStart + "T00:00:00Z")
      .lte("created_at", overallEnd   + "T23:59:59Z"),
    supabase
      .from("settlement_payments")
      .select("canteen_id, amount_paid, period_start, period_end, created_at")
      .gte("period_start", overallStart)
      .lte("period_end",   overallEnd),
    supabase.from("platform_charges").select("*").limit(1),
  ]);

  const charges   = chargesRows?.[0];
  const chargePct  = Number(charges?.charge_pct  ?? 2.0);
  const flatCharge = Number(charges?.flat_charge ?? 0.0);
  const gstPct     = Number(charges?.gst_pct     ?? 18.0);

  const report = weeks.map(w => {
    const weekOrders = (orders ?? []).filter(o => {
      const d = o.created_at.slice(0, 10);
      return d >= w.start && d <= w.end;
    });
    const completed = weekOrders.filter(o => o.status === "collected");
    const gross     = completed.reduce((s, o) => s + Number(o.total_amount), 0);
    const rawFee    = gross * (chargePct / 100) + flatCharge * completed.length;
    const gstFee    = rawFee * (gstPct / 100);
    const totalFee  = rawFee + gstFee;
    const net       = Math.max(0, gross - totalFee);

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
      total_platform_earnings: r2(totalFee),
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
    total_platform_earnings: r2(report.reduce((s, w) => s + w.total_platform_earnings, 0)),
    net_payable:             r2(report.reduce((s, w) => s + w.net_payable, 0)),
    amount_paid:             r2(report.reduce((s, w) => s + w.amount_paid, 0)),
    amount_pending:          r2(report.reduce((s, w) => s + w.amount_pending, 0)),
    total_orders:             report.reduce((s, w) => s + w.total_orders, 0),
    completed_orders:         report.reduce((s, w) => s + w.completed_orders, 0),
  };

  return Response.json({ weeks: report, totals, platform_charges: { chargePct, flatCharge, gstPct } });
}
