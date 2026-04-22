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

  return {
    id:           String(row.id),
    uid:          String(row.user_id),
    customerName: String((row.profiles as Record<string, unknown> | null)?.name ?? row.user_id ?? ""),
    items,
    total:        Number(row.total_amount ?? 0),
    status:       (row.status as OrderStatus) ?? "received",
    createdAt:    String(row.created_at ?? new Date().toISOString()),
  };
}

export async function listOrdersForUser(uid: string): Promise<CanteenOrder[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("orders")
    .select("*, order_items(*, menu_items(name)), profiles(name)")
    .eq("user_id", uid)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []).map((row) => toCanteenOrder(row as Record<string, unknown>));
}

export async function listRecentOrders(limitCount = 100): Promise<CanteenOrder[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("orders")
    .select("*, order_items(*, menu_items(name)), profiles(name)")
    .order("created_at", { ascending: false })
    .limit(limitCount);
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
