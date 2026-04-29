import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

interface OrderRow {
  id: string;
  status: string;
  pickup_slot?: string | null;
  time_slots?: { slot_name?: string | null; start_time?: string | null; end_time?: string | null } | null;
  order_items?: Array<{
    quantity: number;
    menu_items: {
      name: string;
      availability_type?: string | null;
      is_meal?: boolean | null;
    } | null;
  }> | null;
}

interface PrepRow {
  name: string;
  quantity: number;
  availabilityType: "batched_prepared" | "slot_based";
  isMeal: boolean;
}

/**
 * GET /api/canteen/prep-summary
 *   Returns per-slot prep summary split into:
 *     - batched (availability_type='batched_prepared') — the cap from slot_control.batched_prepared_cap applies
 *     - made_to_order (availability_type='slot_based')   — the cap from slot_control.made_to_order_cap applies
 *   Plus aggregated totals for the canteen-wide prep view.
 */
export async function GET(request: Request) {
  const auth = await getRequestContext(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!["worker", "canteen_admin", "vendor", "co_admin", "super_admin"].includes(auth.role)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const url = new URL(request.url);
  const queryCanteenId = url.searchParams.get("canteenId");
  const canteenId =
    auth.role === "super_admin" || auth.role === "co_admin"
      ? (queryCanteenId ?? auth.canteenId ?? null)
      : (auth.canteenId ?? null);
  if (!canteenId) return NextResponse.json({ error: "canteenId required." }, { status: 400 });

  const supabase = createAdminClient();

  // Pull active (not yet collected/cancelled) orders with line items.
  // Resilient: if the production DB hasn't yet had the phase-1 migration that
  // adds menu_items.availability_type / is_meal, fall back to the base columns
  // so the page still renders (everything will default to batched_prepared).
  const fullSelect = `
      id, status, pickup_slot,
      time_slots(slot_name, start_time, end_time),
      order_items(quantity, menu_items(name, availability_type, is_meal))
    `;
  const baseSelect = `
      id, status, pickup_slot,
      time_slots(slot_name, start_time, end_time),
      order_items(quantity, menu_items(name))
    `;
  let orders: unknown[] | null = null;
  let lastError: string | null = null;
  for (const sel of [fullSelect, baseSelect]) {
    const { data, error } = await supabase
      .from("orders")
      .select(sel)
      .eq("canteen_id", canteenId)
      .in("status", ["placed", "confirmed", "preparing", "ready_for_placement"])
      .limit(500);
    if (!error) { orders = data ?? []; break; }
    lastError = error.message;
    if (!/column .* does not exist/i.test(error.message)) break;
  }
  if (orders === null) {
    return NextResponse.json({ error: lastError ?? "Failed to load prep summary." }, { status: 500 });
  }

  // Aggregate per slot, split by availability_type
  const slotMap: Record<string, { batched: Map<string, PrepRow>; madeToOrder: Map<string, PrepRow> }> = {};

  for (const o of (orders ?? []) as unknown as OrderRow[]) {
    const slot = o.time_slots?.slot_name ?? o.pickup_slot ?? "Unknown";
    if (!slotMap[slot]) slotMap[slot] = { batched: new Map(), madeToOrder: new Map() };
    for (const li of o.order_items ?? []) {
      const m = li.menu_items;
      if (!m) continue;
      const isBatched = (m.availability_type ?? "batched_prepared") === "batched_prepared";
      const bucket = isBatched ? slotMap[slot].batched : slotMap[slot].madeToOrder;
      const existing = bucket.get(m.name);
      if (existing) {
        existing.quantity += li.quantity;
      } else {
        bucket.set(m.name, {
          name: m.name,
          quantity: li.quantity,
          availabilityType: isBatched ? "batched_prepared" : "slot_based",
          isMeal: m.is_meal ?? false,
        });
      }
    }
  }

  // Pull caps for context
  const { data: sc } = await supabase
    .from("slot_control")
    .select("batched_prepared_cap, made_to_order_cap, max_orders_per_slot, max_bins")
    .eq("canteen_id", canteenId)
    .maybeSingle();

  const result = Object.entries(slotMap).map(([slot, buckets]) => ({
    slot,
    batched:       Array.from(buckets.batched.values()).sort((a, b) => b.quantity - a.quantity),
    made_to_order: Array.from(buckets.madeToOrder.values()).sort((a, b) => b.quantity - a.quantity),
  }));

  return NextResponse.json({
    slots: result,
    caps: sc ?? null,
    canteen_id: canteenId,
  });
}
