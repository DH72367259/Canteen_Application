/**
 * GET /api/canteen/sales
 *
 * Returns sales aggregates for the calling canteen at multiple granularities:
 *   - today, week, month, quarter, year (single totals)
 *   - hourly (24 buckets for IST today)
 *   - daily  (last 30 days)
 *   - monthly(last 12 months)
 *
 * Counts every non-cancelled order so Sales updates as soon as a payment
 * lands, regardless of whether OTP collection has happened yet (Earnings
 * is the OTP-gated, payout-relevant view).
 */
import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

function r2(n: number) { return Math.round(n * 100) / 100; }

// IST helpers — all bucketing is done in IST so "today" matches the vendor's
// physical clock regardless of where the server runs.
const IST_OFFSET_MIN = 330;
function toIst(d: Date): Date { return new Date(d.getTime() + IST_OFFSET_MIN * 60_000); }
function istUtcStart(d: Date): Date {
  const ist = toIst(d);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MIN * 60_000);
}

export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["canteen_admin", "vendor", "super_admin", "co_admin", "worker"].includes(ctx.role ?? "")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createAdminClient();

  // Resolve canteen_id from profile (super_admin can pass canteen_id)
  const { data: profile } = await supabase
    .from("profiles").select("canteen_id").eq("id", ctx.uid).single();
  const url = new URL(request.url);
  const canteenId = ctx.role === "super_admin"
    ? (url.searchParams.get("canteen_id") || profile?.canteen_id)
    : profile?.canteen_id;
  if (!canteenId) return Response.json({ error: "No canteen associated" }, { status: 404 });

  // Pull the last 12 months of orders once and bucket in JS — small dataset
  // and one round-trip beats five aggregated queries.
  const now = new Date();
  const istNow = toIst(now);
  const todayStart   = istUtcStart(now);
  const yearStart    = new Date(Date.UTC(istNow.getUTCFullYear(), 0, 1) - IST_OFFSET_MIN * 60_000);

  const { data: rows, error } = await supabase
    .from("orders")
    .select("id, total_amount, status, created_at")
    .eq("canteen_id", canteenId)
    .gte("created_at", yearStart.toISOString())
    .neq("status", "cancelled");

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const orders = rows ?? [];

  // Period boundaries (all in UTC ms)
  const todayMs    = todayStart.getTime();
  const weekStart  = new Date(todayMs - ((toIst(now).getUTCDay() + 6) % 7) * 86_400_000); // Mon-start
  const monthStart = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), 1) - IST_OFFSET_MIN * 60_000);
  const qIdx       = Math.floor(istNow.getUTCMonth() / 3);
  const quarterStart = new Date(Date.UTC(istNow.getUTCFullYear(), qIdx * 3, 1) - IST_OFFSET_MIN * 60_000);

  let today = 0, week = 0, month = 0, quarter = 0, year = 0;
  let todayCount = 0, weekCount = 0, monthCount = 0, quarterCount = 0, yearCount = 0;
  const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, revenue: 0, orders: 0 }));
  const daily: { date: string; revenue: number; orders: number }[] = [];
  const dailyMap = new Map<string, { date: string; revenue: number; orders: number }>();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(todayMs - i * 86_400_000);
    const istD = toIst(d);
    const key = `${istD.getUTCFullYear()}-${String(istD.getUTCMonth() + 1).padStart(2, "0")}-${String(istD.getUTCDate()).padStart(2, "0")}`;
    const bucket = { date: key, revenue: 0, orders: 0 };
    dailyMap.set(key, bucket);
    daily.push(bucket);
  }
  const monthly: { month: string; revenue: number; orders: number }[] = [];
  const monthlyMap = new Map<string, { month: string; revenue: number; orders: number }>();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    const bucket = { month: label, revenue: 0, orders: 0 };
    monthlyMap.set(key, bucket);
    monthly.push(bucket);
  }

  for (const o of orders) {
    const amt = Number(o.total_amount || 0);
    const ts  = new Date(o.created_at).getTime();
    const istD = toIst(new Date(ts));
    if (ts >= yearStart.getTime())   { year    += amt; yearCount++; }
    if (ts >= quarterStart.getTime()){ quarter += amt; quarterCount++; }
    if (ts >= monthStart.getTime())  { month   += amt; monthCount++; }
    if (ts >= weekStart.getTime())   { week    += amt; weekCount++; }
    if (ts >= todayMs)               {
      today += amt; todayCount++;
      const h = istD.getUTCHours();
      hourly[h].revenue += amt; hourly[h].orders += 1;
    }
    const dKey = `${istD.getUTCFullYear()}-${String(istD.getUTCMonth() + 1).padStart(2, "0")}-${String(istD.getUTCDate()).padStart(2, "0")}`;
    const dB = dailyMap.get(dKey);
    if (dB) { dB.revenue += amt; dB.orders += 1; }
    const mKey = `${istD.getUTCFullYear()}-${String(istD.getUTCMonth() + 1).padStart(2, "0")}`;
    const mB = monthlyMap.get(mKey);
    if (mB) { mB.revenue += amt; mB.orders += 1; }
  }

  return Response.json({
    totals: {
      today:   { revenue: r2(today),   orders: todayCount },
      week:    { revenue: r2(week),    orders: weekCount },
      month:   { revenue: r2(month),   orders: monthCount },
      quarter: { revenue: r2(quarter), orders: quarterCount },
      year:    { revenue: r2(year),    orders: yearCount },
    },
    hourly: hourly.map(h => ({ ...h, revenue: r2(h.revenue) })),
    daily:  daily.map(d  => ({ ...d,  revenue: r2(d.revenue) })),
    monthly: monthly.map(m => ({ ...m, revenue: r2(m.revenue) })),
  });
}
