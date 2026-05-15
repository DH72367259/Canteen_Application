/**
 * GET /api/canteen/slot-analytics?date=YYYY-MM-DD
 *
 * Returns orders grouped by slot_label for a given IST date (defaults to today).
 * Includes per-slot item breakdown so the vendor can see what was ordered in
 * each time window.
 *
 * Response:
 *   { date, slots: [{ label, order_count, revenue, items: [{ name, category, quantity, revenue }] }] }
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
function istDayEnd(start: Date): Date {
  return new Date(start.getTime() + 86_400_000);
}

export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const allowed = ["canteen_admin", "vendor", "super_admin", "co_admin"];
  if (!allowed.includes(ctx.role ?? ""))
    return Response.json({ error: "Forbidden" }, { status: 403 });

  const supabase = createAdminClient();
  const url = new URL(request.url);

  const { data: profile } = await supabase
    .from("profiles").select("canteen_id").eq("id", ctx.uid).single();

  const canteenId =
    ctx.role === "super_admin" || ctx.role === "co_admin"
      ? (url.searchParams.get("canteen_id") || profile?.canteen_id)
      : profile?.canteen_id;

  if (!canteenId)
    return Response.json({ error: "No canteen associated with this account." }, { status: 404 });

  // Parse date param or default to IST today
  const now = new Date();
  let dayStart: Date;
  const dateParam = url.searchParams.get("date");
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    // Parse as IST midnight
    const [y, m, d] = dateParam.split("-").map(Number);
    dayStart = new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MIN * 60_000);
  } else {
    dayStart = istDayStart(now);
  }
  const dayEnd = istDayEnd(dayStart);
  const dateLabel = toIst(dayStart).toISOString().slice(0, 10);

  // Fetch all non-cancelled orders for this day with slot_label
  const { data: orders, error: ordErr } = await supabase
    .from("orders")
    .select("id, slot_label, total_amount, status, created_at")
    .eq("canteen_id", canteenId)
    .gte("created_at", dayStart.toISOString())
    .lt("created_at", dayEnd.toISOString())
    .neq("status", "cancelled")
    .order("slot_label", { ascending: true });

  if (ordErr) return Response.json({ error: ordErr.message }, { status: 500 });

  const orderList = orders ?? [];
  if (orderList.length === 0) {
    return Response.json({ date: dateLabel, slots: [] });
  }

  const orderIds = orderList.map(o => o.id);

  // Fetch order_items for those orders
  const { data: rawItems, error: itemErr } = await supabase
    .from("order_items")
    .select("order_id, quantity, cancelled_quantity, unit_price, menu_item_id, menu_items(name, category)")
    .in("order_id", orderIds);

  if (itemErr) return Response.json({ error: itemErr.message }, { status: 500 });

  // Map order_id → slot_label and total_amount
  const orderSlot = new Map<string, string>();
  const slotRevenue = new Map<string, number>();
  const slotCount = new Map<string, number>();

  for (const o of orderList) {
    const label = o.slot_label ?? "Unassigned";
    orderSlot.set(o.id, label);
    slotRevenue.set(label, (slotRevenue.get(label) ?? 0) + Number(o.total_amount ?? 0));
    slotCount.set(label, (slotCount.get(label) ?? 0) + 1);
  }

  // Aggregate items per slot
  type SlotItem = { name: string; category: string; quantity: number; revenue: number };
  const slotItems = new Map<string, Map<string, SlotItem>>();

  for (const row of rawItems ?? []) {
    const qty = Math.max(0, Number(row.quantity ?? 0) - Number(row.cancelled_quantity ?? 0));
    if (qty === 0) continue;

    const slotLabel = orderSlot.get(row.order_id) ?? "Unassigned";
    const menuItem = Array.isArray(row.menu_items) ? row.menu_items[0] : row.menu_items;
    const name = (menuItem as { name?: string } | null)?.name ?? "Unknown Item";
    const category = (menuItem as { category?: string } | null)?.category ?? "";
    const rev = qty * Number(row.unit_price ?? 0);

    if (!slotItems.has(slotLabel)) slotItems.set(slotLabel, new Map());
    const itemMap = slotItems.get(slotLabel)!;
    const key = row.menu_item_id ?? name;
    const prev = itemMap.get(key) ?? { name, category, quantity: 0, revenue: 0 };
    prev.quantity += qty;
    prev.revenue += rev;
    itemMap.set(key, prev);
  }

  // Build sorted slot list (sort by slot label time string)
  const allSlots = Array.from(new Set([...slotRevenue.keys()])).sort();

  const slots = allSlots.map(label => {
    const items = Array.from((slotItems.get(label) ?? new Map()).values())
      .sort((a, b) => b.quantity - a.quantity)
      .map(i => ({ ...i, revenue: r2(i.revenue) }));

    return {
      label,
      order_count: slotCount.get(label) ?? 0,
      revenue: r2(slotRevenue.get(label) ?? 0),
      items,
    };
  });

  return Response.json({ date: dateLabel, slots });
}
