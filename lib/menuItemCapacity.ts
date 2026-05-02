import { createAdminClient } from "@/lib/supabase-server";

interface CapacityUsageOptions {
  canteenId: string;
  menuItemIds: string[];
  slotId?: string | null;
  slotLabel?: string | null;
}

interface CapacityUsageResult {
  dayUsed: Map<string, number>;
  slotUsed: Map<string, number>;
}

function istDayStartIso(now = new Date()): string {
  const istNow = new Date(now.getTime() + 330 * 60_000);
  const yyyy = istNow.getUTCFullYear();
  const mm = String(istNow.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(istNow.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T00:00:00+05:30`;
}

export async function getMenuItemUsageForToday(
  supabase: ReturnType<typeof createAdminClient>,
  options: CapacityUsageOptions,
): Promise<CapacityUsageResult> {
  const { canteenId, menuItemIds, slotId, slotLabel } = options;
  const out: CapacityUsageResult = { dayUsed: new Map(), slotUsed: new Map() };

  if (menuItemIds.length === 0) return out;

  const { data: orders, error: ordersErr } = await supabase
    .from("orders")
    .select("id, slot_id, slot_label")
    .eq("canteen_id", canteenId)
    .gte("created_at", istDayStartIso())
    .not("status", "in", '("cancelled","refunded")')
    .limit(2000);
  if (ordersErr || !orders || orders.length === 0) return out;

  const orderIds = orders.map((o) => o.id as string);
  const slotOrderIds = new Set(
    orders
      .filter((o) => {
        if (slotId) return String(o.slot_id ?? "") === slotId;
        if (slotLabel) return String(o.slot_label ?? "") === slotLabel;
        return false;
      })
      .map((o) => String(o.id)),
  );

  const readItems = async (withCancelled: boolean) => {
    const cols = withCancelled
      ? "order_id, menu_item_id, quantity, cancelled_quantity"
      : "order_id, menu_item_id, quantity";
    return supabase
      .from("order_items")
      .select(cols)
      .in("order_id", orderIds)
      .in("menu_item_id", menuItemIds);
  };

  let itemRows = await readItems(true);
  if (itemRows.error && /cancelled_quantity|column .* does not exist/i.test(itemRows.error.message)) {
    itemRows = await readItems(false);
  }
  if (itemRows.error || !itemRows.data) return out;

  for (const row of itemRows.data as unknown as Array<Record<string, unknown>>) {
    const menuItemId = String(row.menu_item_id ?? "");
    const orderId = String(row.order_id ?? "");
    const quantity = Number(row.quantity ?? 0);
    const cancelled = Number(row.cancelled_quantity ?? 0);
    const net = Math.max(0, quantity - (Number.isFinite(cancelled) ? cancelled : 0));
    if (!menuItemId || !orderId || net <= 0) continue;

    out.dayUsed.set(menuItemId, (out.dayUsed.get(menuItemId) ?? 0) + net);
    if (slotOrderIds.has(orderId)) {
      out.slotUsed.set(menuItemId, (out.slotUsed.get(menuItemId) ?? 0) + net);
    }
  }

  return out;
}