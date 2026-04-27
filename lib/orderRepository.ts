import { createAdminClient } from "@/lib/supabase-server";
import type { CanteenOrder, OrderStatus } from "@/types/canteen";

// Map Supabase order row → CanteenOrder (legacy type used by existing API routes)
function toCanteenOrder(row: Record<string, unknown>): CanteenOrder {
  const items = Array.isArray(row.order_items)
    ? (row.order_items as Record<string, unknown>[]).map((i) => ({
        itemId:    String(i.menu_item_id ?? ""),
        name:      String((i.menu_items as Record<string, unknown> | null)?.name ?? i.menu_item_id ?? ""),
        unitPrice: Number(i.unit_price ?? 0),
        quantity:  Number(i.quantity ?? 0),
        lineTotal: Number(i.unit_price ?? 0) * Number(i.quantity ?? 0),
      }))
    : [];

  const rawStatusMap: Record<string, "received" | "preparing" | "ready" | "completed" | "cancelled"> = {
    placed: "received", confirmed: "preparing", preparing: "preparing",
    ready_for_placement: "ready", placed_in_bin: "ready",
    ready_for_pickup: "ready", collected: "completed", cancelled: "cancelled",
    grace_bin: "ready",
  };
  const rawSt = String(row.status ?? "placed");

  const binRow  = row.bins  as Record<string, unknown> | null;
  const slotRow = row.time_slots as Record<string, unknown> | null;

  return {
    id:           String(row.id),
    uid:          String(row.user_id),
    customerName: String((row.profiles as Record<string, unknown> | null)?.name ?? row.user_id ?? ""),
    items,
    total:        Number(row.total_amount ?? 0),
    status:       rawStatusMap[rawSt] ?? "received",
    rawStatus:    rawSt,
    createdAt:    String(row.created_at ?? new Date().toISOString()),
    canteenId:    row.canteen_id ? String(row.canteen_id) : undefined,
    canteenName:  (row.canteens as Record<string, unknown> | null)?.name
                    ? String((row.canteens as Record<string, unknown>).name) : undefined,
    paymentId:    row.payment_id ? String(row.payment_id) : undefined,
    otp:          row.otp ? String(row.otp) : undefined,
    binLabel:     binRow?.bin_code ? String(binRow.bin_code) : (row.bin_label ? String(row.bin_label) : undefined),
    binColor:     binRow?.color ? String(binRow.color) : (row.bin_color ? String(row.bin_color) : undefined),
    binId:        row.bin_id ? String(row.bin_id) : undefined,
    pickupSlot:   slotRow?.slot_name ? String(slotRow.slot_name) : undefined,
    slotLabel:    row.slot_label ? String(row.slot_label) : undefined,
  };
}

export async function listOrdersForUser(uid: string): Promise<CanteenOrder[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("orders")
    .select("*, order_items(*, menu_items(name)), profiles(name), canteens(name)")
    .eq("user_id", uid)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []).map((row) => toCanteenOrder(row as Record<string, unknown>));
}

export async function listRecentOrders(limitCount = 100, canteenId?: string): Promise<CanteenOrder[]> {
  const supabase = createAdminClient();
  let query = supabase
    .from("orders")
    .select("*, order_items(*, menu_items(name)), profiles(name), canteens(name), bins(id, bin_code, color), time_slots(slot_name, start_time, end_time)")
    // Skipped orders go to the back of the queue (NULLS FIRST = un-skipped first when ASC),
    // then newest first within each bucket.
    .order("skipped_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: false })
    .limit(limitCount);
  if (canteenId) query = query.eq("canteen_id", canteenId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => toCanteenOrder(row as Record<string, unknown>));
}

export async function createOrder(
  order: Omit<{ id: string; uid: string; customerName: string; items: CanteenOrder["items"]; total: number; status: OrderStatus; createdAt: string; updatedAt: string }, "id" | "updatedAt">
): Promise<CanteenOrder> {
  const supabase = createAdminClient();

  // Resolve canteen_id from user profile (defaults to first canteen if not set)
  const { data: profile } = await supabase.from("profiles").select("canteen_id").eq("id", order.uid).single();
  let canteenId: string = profile?.canteen_id ?? "";
  if (!canteenId) {
    const { data: firstCanteen } = await supabase.from("canteens").select("id").limit(1).single();
    canteenId = firstCanteen?.id ?? "";
  }

  const { data: row, error } = await supabase
    .from("orders")
    .insert({
      user_id:      order.uid,
      canteen_id:   canteenId,
      total_amount: order.total,
      status:       order.status ?? "received",
    })
    .select("id, user_id, total_amount, status, created_at")
    .single();
  if (error || !row) throw error ?? new Error("Failed to create order");

  // Insert order items
  if (order.items.length > 0) {
    await supabase.from("order_items").insert(
      order.items.map((item) => ({
        order_id:     row.id,
        menu_item_id: item.itemId,
        quantity:     item.quantity,
        unit_price:   item.unitPrice,
      }))
    );
  }

  return {
    id:           row.id,
    uid:          row.user_id,
    customerName: order.customerName,
    items:        order.items,
    total:        Number(row.total_amount),
    status:       row.status as OrderStatus,
    createdAt:    row.created_at,
  };
}

export async function updateOrderStatus(id: string, status: OrderStatus): Promise<CanteenOrder | null> {
  const supabase = createAdminClient();
  const { data: row, error } = await supabase
    .from("orders")
    .update({ status })
    .eq("id", id)
    .select("*, order_items(*, menu_items(name)), profiles(name)")
    .single();
  if (error) return null;
  return toCanteenOrder(row as Record<string, unknown>);
}
