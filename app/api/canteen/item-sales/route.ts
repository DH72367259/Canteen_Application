/**
 * GET /api/canteen/item-sales?period=today|week|month
 *
 * Returns per-item quantity and revenue breakdown for the calling canteen.
 * super_admin and co_admin can pass ?canteen_id= to view any canteen.
 *
 * Response:
 *   { period, period_label, period_start, period_end,
 *     total_quantity, total_revenue, total_orders,
 *     items: [{ name, category, quantity, revenue, rank }] }
 */
import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

function r2(n: number) { return Math.round(n * 100) / 100; }

const IST_OFFSET_MIN = 330;
function toIst(d: Date): Date { return new Date(d.getTime() + IST_OFFSET_MIN * 60_000); }
function istDayStart(d: Date): Date {
  const ist = toIst(d);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MIN * 60_000);
}

export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const allowed = ["canteen_admin", "vendor", "super_admin", "co_admin"];
  if (!allowed.includes(ctx.role ?? ""))
    return Response.json({ error: "Forbidden" }, { status: 403 });

  const supabase = createAdminClient();
  const url = new URL(request.url);
  const period = (url.searchParams.get("period") ?? "week") as "today" | "week" | "month";

  const { data: profile } = await supabase
    .from("profiles").select("canteen_id").eq("id", ctx.uid).single();

  const canteenId =
    ctx.role === "super_admin" || ctx.role === "co_admin"
      ? (url.searchParams.get("canteen_id") || profile?.canteen_id)
      : profile?.canteen_id;

  if (!canteenId)
    return Response.json({ error: "No canteen associated with this account." }, { status: 404 });

  const now = new Date();
  const istNow = toIst(now);
  const todayStartUtc = istDayStart(now);

  let periodStart: Date;
  let periodLabel: string;

  if (period === "today") {
    periodStart = todayStartUtc;
    periodLabel = "Today";
  } else if (period === "week") {
    const dayOfWeek = (istNow.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
    periodStart = new Date(todayStartUtc.getTime() - dayOfWeek * 86_400_000);
    periodLabel = "This Week";
  } else {
    periodStart = new Date(
      Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), 1) - IST_OFFSET_MIN * 60_000
    );
    periodLabel = "This Month";
  }

  const periodEnd = now;

  // Step 1: get non-cancelled orders in the period for this canteen
  const { data: orders, error: ordErr } = await supabase
    .from("orders")
    .select("id")
    .eq("canteen_id", canteenId)
    .gte("created_at", periodStart.toISOString())
    .lte("created_at", periodEnd.toISOString())
    .neq("status", "cancelled");

  if (ordErr) return Response.json({ error: ordErr.message }, { status: 500 });

  const orderIds = (orders ?? []).map((o) => o.id);

  if (orderIds.length === 0) {
    return Response.json({
      period,
      period_label: periodLabel,
      period_start: periodStart.toISOString().slice(0, 10),
      period_end:   periodEnd.toISOString().slice(0, 10),
      total_quantity: 0,
      total_revenue:  0,
      total_orders:   0,
      items: [],
    });
  }

  // Step 2: fetch order_items + menu_item name/category for those orders
  const { data: rawItems, error: itemErr } = await supabase
    .from("order_items")
    .select("order_id, quantity, cancelled_quantity, unit_price, menu_item_id, menu_items(name, category)")
    .in("order_id", orderIds);

  if (itemErr) return Response.json({ error: itemErr.message }, { status: 500 });

  // Step 3: aggregate by item
  type ItemAgg = { name: string; category: string; quantity: number; revenue: number };
  const byItem = new Map<string, ItemAgg>();

  for (const row of rawItems ?? []) {
    const qty = Math.max(
      0,
      Number(row.quantity ?? 0) - Number(row.cancelled_quantity ?? 0)
    );
    if (qty === 0) continue;

    const menuItem = Array.isArray(row.menu_items) ? row.menu_items[0] : row.menu_items;
    const name     = (menuItem as { name?: string } | null)?.name ?? "Unknown Item";
    const category = (menuItem as { category?: string } | null)?.category ?? "";
    const revenue  = qty * Number(row.unit_price ?? 0);

    const key  = row.menu_item_id ?? name;
    const prev = byItem.get(key) ?? { name, category, quantity: 0, revenue: 0 };
    prev.quantity += qty;
    prev.revenue  += revenue;
    byItem.set(key, prev);
  }

  const items = Array.from(byItem.values())
    .sort((a, b) => b.quantity - a.quantity)
    .map((item, i) => ({ ...item, revenue: r2(item.revenue), rank: i + 1 }));

  const totalQuantity = items.reduce((s, i) => s + i.quantity, 0);
  const totalRevenue  = r2(items.reduce((s, i) => s + i.revenue, 0));

  return Response.json({
    period,
    period_label:  periodLabel,
    period_start:  periodStart.toISOString().slice(0, 10),
    period_end:    periodEnd.toISOString().slice(0, 10),
    total_quantity: totalQuantity,
    total_revenue:  totalRevenue,
    total_orders:   orderIds.length,
    items,
  });
}
