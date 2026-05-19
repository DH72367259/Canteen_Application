import type { SupabaseClient } from "@supabase/supabase-js";
import { autoCancelOutOfStock } from "@/lib/orderAutoCancelOutOfStock";

export interface AutoAcceptOptions {
  supabase: SupabaseClient;
  canteenId?: string;
  userId?: string;
}

function nowISTMinutes(): number {
  const now = new Date();
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

function istDayStartIso(now = new Date()): string {
  const istNow = new Date(now.getTime() + 330 * 60_000);
  const yyyy = istNow.getUTCFullYear();
  const mm = String(istNow.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(istNow.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T00:00:00+05:30`;
}

function parseSlotStartMinutes(slotLabel: string): number | null {
  const m = slotLabel.trim().match(/^(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const isPm = m[3].toUpperCase() === "PM";
  if (isPm && h !== 12) h += 12;
  if (!isPm && h === 12) h = 0;
  return h * 60 + min;
}

interface CandidateOrder {
  id: string;
  canteen_id: string;
  slot_label: string | null;
  created_at: string;
  user_id: string | null;
  payment_id: string | null;
  total_amount: number | string | null;
}

interface OrderItem {
  order_id: string;
  menu_item_id: string;
  quantity: number;
  itemName: string;
  availType: string;
  slotCap: number;
  dayCap: number;
}

/**
 * Promotes `placed` orders to `confirmed` when their slot has arrived,
 * walking candidates in FIFO order (oldest first). Each order is checked
 * against current inventory caps; orders that would push consumption past
 * the configured slot or day cap are auto-cancelled instead — with a full
 * Razorpay refund and a bell-icon notification to the student (see
 * lib/orderAutoCancelOutOfStock.ts).
 *
 * This is a safety net for the case where an admin reduced an item's cap
 * after orders were placed. The placement-time atomic check in
 * /api/orders/place prevents oversells in the normal flow.
 */
export async function autoAcceptPlacedOrders(
  options: AutoAcceptOptions,
): Promise<{ updatedCount: number; autoCancelledCount: number }> {
  const { supabase, canteenId, userId } = options;

  let q = supabase
    .from("orders")
    .select("id, canteen_id, slot_label, created_at, user_id, payment_id, total_amount")
    .eq("status", "placed");

  if (canteenId) q = q.eq("canteen_id", canteenId);
  if (userId)    q = q.eq("user_id", userId);

  const { data: orders } = await q;
  if (!orders?.length) return { updatedCount: 0, autoCancelledCount: 0 };

  const nowMin = nowISTMinutes();
  const nowMs  = Date.now();
  const candidates: CandidateOrder[] = [];

  for (const order of orders as CandidateOrder[]) {
    const label = String(order.slot_label ?? "");
    const startMin = parseSlotStartMinutes(label);
    if (startMin !== null) {
      if (nowMin >= startMin) candidates.push(order);
    } else {
      const ageMs = nowMs - new Date(String(order.created_at)).getTime();
      if (ageMs >= 35_000) candidates.push(order);
    }
  }

  if (!candidates.length) return { updatedCount: 0, autoCancelledCount: 0 };

  // FIFO: oldest first wins the inventory.
  candidates.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  // Fetch each candidate's items + the menu_item caps in one go.
  const candidateIds = candidates.map((c) => c.id);
  const { data: rawItems } = await supabase
    .from("order_items")
    .select("order_id, menu_item_id, quantity, menu_items(name, availability_type, quantity_per_slot, total_per_day)")
    .in("order_id", candidateIds);

  const itemsByOrder = new Map<string, OrderItem[]>();
  for (const row of (rawItems ?? []) as unknown as Array<Record<string, unknown>>) {
    const m = (row.menu_items ?? {}) as Record<string, unknown>;
    const orderId = String(row.order_id ?? "");
    if (!orderId) continue;
    const list = itemsByOrder.get(orderId) ?? [];
    list.push({
      order_id: orderId,
      menu_item_id: String(row.menu_item_id ?? ""),
      quantity: Number(row.quantity ?? 0),
      itemName: String(m.name ?? "Item"),
      availType: String(m.availability_type ?? "slot_based"),
      slotCap: Number(m.quantity_per_slot ?? 0),
      dayCap: Number(m.total_per_day ?? 0),
    });
    itemsByOrder.set(orderId, list);
  }

  // Build the "already committed" baseline: today's orders past 'placed'.
  // The candidates themselves are still 'placed' — accounted for in the
  // FIFO walk below, not in this baseline.
  const baselineByCanteen = new Map<string, { day: Map<string, number>; slot: Map<string, number> }>();
  const canteenIds = [...new Set(candidates.map((c) => c.canteen_id))];
  if (canteenIds.length) {
    const { data: committedOrders } = await supabase
      .from("orders")
      .select("id, canteen_id, slot_label")
      .in("canteen_id", canteenIds)
      .gte("created_at", istDayStartIso())
      .in("status", ["confirmed", "placed_in_bin", "ready_for_pickup", "late_pickup", "collected"]);
    const committedIds = (committedOrders ?? []).map((o) => String((o as { id: unknown }).id));
    if (committedIds.length) {
      const { data: committedItems } = await supabase
        .from("order_items")
        .select("order_id, menu_item_id, quantity")
        .in("order_id", committedIds);
      const orderById = new Map(
        (committedOrders ?? []).map((o) => [
          String((o as { id: unknown }).id),
          {
            canteen: String((o as { canteen_id: unknown }).canteen_id ?? ""),
            slot: String((o as { slot_label: unknown }).slot_label ?? ""),
          },
        ]),
      );
      for (const row of committedItems ?? []) {
        const r = row as { order_id: unknown; menu_item_id: unknown; quantity: unknown };
        const oid = String(r.order_id);
        const meta = orderById.get(oid);
        if (!meta) continue;
        const mid = String(r.menu_item_id);
        const qty = Number(r.quantity ?? 0);
        const entry = baselineByCanteen.get(meta.canteen) ?? { day: new Map(), slot: new Map() };
        entry.day.set(mid, (entry.day.get(mid) ?? 0) + qty);
        const slotKey = `${meta.slot}|${mid}`;
        entry.slot.set(slotKey, (entry.slot.get(slotKey) ?? 0) + qty);
        baselineByCanteen.set(meta.canteen, entry);
      }
    }
  }

  const confirmed: string[] = [];
  const rejected: Array<{ order: CandidateOrder; missingItem: string }> = [];

  for (const order of candidates) {
    const items = itemsByOrder.get(order.id) ?? [];
    const baseline = baselineByCanteen.get(order.canteen_id) ?? { day: new Map(), slot: new Map() };

    let canFulfill = true;
    let missingName = "";

    for (const item of items) {
      const slotKey = `${order.slot_label ?? ""}|${item.menu_item_id}`;
      const newDay = (baseline.day.get(item.menu_item_id) ?? 0) + item.quantity;
      const newSlot = (baseline.slot.get(slotKey) ?? 0) + item.quantity;
      const overSlot = item.availType === "slot_based" && item.slotCap > 0 && newSlot > item.slotCap;
      const overDay  = item.availType === "batched_prepared" && item.dayCap > 0 && newDay > item.dayCap;
      if (overSlot || overDay) {
        canFulfill = false;
        missingName = item.itemName;
        break;
      }
    }

    if (canFulfill) {
      // Provisionally reserve so subsequent candidates see this consumption.
      for (const item of items) {
        const slotKey = `${order.slot_label ?? ""}|${item.menu_item_id}`;
        baseline.day.set(item.menu_item_id, (baseline.day.get(item.menu_item_id) ?? 0) + item.quantity);
        baseline.slot.set(slotKey, (baseline.slot.get(slotKey) ?? 0) + item.quantity);
      }
      baselineByCanteen.set(order.canteen_id, baseline);
      confirmed.push(order.id);
    } else {
      rejected.push({ order, missingItem: missingName });
    }
  }

  if (confirmed.length) {
    await supabase
      .from("orders")
      .update({ status: "confirmed", updated_at: new Date().toISOString() })
      .in("id", confirmed)
      .eq("status", "placed");
  }

  for (const r of rejected) {
    await autoCancelOutOfStock(supabase, r.order, r.missingItem);
  }

  return { updatedCount: confirmed.length, autoCancelledCount: rejected.length };
}
