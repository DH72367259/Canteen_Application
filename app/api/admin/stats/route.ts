import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

// Platform-wide stats for the super-admin Dashboard + Analytics screens.
// Returns: counts (canteens active, users), today's order tally + revenue,
// month-to-date revenue + orders, plus a recent-activity feed (last 8
// orders). Single endpoint keeps the polling story simple for the UI.
export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
  // Both super_admin and co_admin can view platform stats. co_admin is the
  // operations / read-only counterpart and the /system dashboard depends on
  // this endpoint.
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "super_admin" && ctx.role !== "co_admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const supabase = createAdminClient();

  // Time bounds — IST day boundary cast to UTC for the query.
  const now = new Date();
  const istNowMs   = now.getTime() + 330 * 60_000;
  const ist        = new Date(istNowMs);
  const dayStartUtc = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 330 * 60_000);
  const monthStartUtc = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - 330 * 60_000);

  // Six-month window for monthly chart.
  const sixMonthsAgo = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 5, 1) - 330 * 60_000);

  const [
    { count: canteensActive },
    { count: usersTotal },
    { data: ordersToday, error: ordersTodayErr },
    { data: ordersMonth },
    { data: orders6mo },
    { data: recentRows },
  ] = await Promise.all([
    supabase.from("canteens").select("id", { head: true, count: "exact" }).or("is_active.eq.true,status.eq.active"),
    supabase.from("profiles").select("id", { head: true, count: "exact" }),
    supabase.from("orders").select("id, total_amount, status, canteen_id, created_at").gte("created_at", dayStartUtc.toISOString()),
    supabase.from("orders").select("id, total_amount, status, created_at").gte("created_at", monthStartUtc.toISOString()),
    supabase.from("orders").select("total_amount, status, created_at").gte("created_at", sixMonthsAgo.toISOString()),
    supabase
      .from("orders")
      .select("id, total_amount, status, created_at, canteens(name)")
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  if (ordersTodayErr) {
    return Response.json({ error: "Failed to load orders" }, { status: 500 });
  }

  const completedTodayOrders = (ordersToday ?? []).filter(o => !["cancelled"].includes(o.status));
  const revenueToday = completedTodayOrders.reduce((s, o) => s + Number(o.total_amount || 0), 0);

  const completedMonthOrders = (ordersMonth ?? []).filter(o => !["cancelled"].includes(o.status));
  const revenueMonth = completedMonthOrders.reduce((s, o) => s + Number(o.total_amount || 0), 0);

  // Six-month bucketing for chart (label: "Mon YYYY")
  const buckets = new Map<string, { month: string; revenue: number; orders: number }>();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", { month: "short" });
    buckets.set(key, { month: label, revenue: 0, orders: 0 });
  }
  for (const o of orders6mo ?? []) {
    if (o.status === "cancelled") continue;
    const d = new Date(o.created_at);
    const istD = new Date(d.getTime() + 330 * 60_000);
    const key = `${istD.getUTCFullYear()}-${String(istD.getUTCMonth() + 1).padStart(2, "0")}`;
    const b = buckets.get(key);
    if (!b) continue;
    b.revenue += Number(o.total_amount || 0);
    b.orders  += 1;
  }
  const monthly = Array.from(buckets.values());

  // Recent activity rows (lightweight)
  const recent = (recentRows ?? []).map((r: { id: string; total_amount: number; status: string; created_at: string; canteens?: { name?: string } | { name?: string }[] | null }) => {
    const c = Array.isArray(r.canteens) ? r.canteens[0] : r.canteens;
    return {
      id: r.id,
      time: r.created_at,
      event: r.status === "cancelled" ? "Order cancelled" : "Order placed",
      canteen: c?.name ?? "—",
      detail: `₹${Number(r.total_amount || 0).toFixed(0)} · ${r.status}`,
    };
  });

  return Response.json({
    counts: {
      canteens_active: canteensActive ?? 0,
      users_total:     usersTotal ?? 0,
    },
    today: {
      orders:  completedTodayOrders.length,
      revenue: Math.round(revenueToday * 100) / 100,
    },
    month: {
      orders:  completedMonthOrders.length,
      revenue: Math.round(revenueMonth * 100) / 100,
    },
    monthly,
    recent,
  });
}
