import { createAdminClient } from "@/lib/supabase-server";
import { getRequestContext } from "@/lib/authServer";
import { assignBins, computeSlotCapacity, type CartLine } from "@/lib/slotCapacity";
import { ensureSlotControl } from "@/lib/slotControlEnsure";
import { getMenuItemUsageForToday, getSlotAvailabilityUsage } from "@/lib/menuItemCapacity";

export const dynamic = "force-dynamic";

interface CartCheckBody {
  canteen_id: string;
  slot: string; // slot label, e.g. "12:30 PM"
  items: Array<{ id: string; quantity: number }>;
}

/**
 * POST /api/cart/check
 *
 * Pre-checkout validation for the user app cart. Returns whether the chosen
 * slot still has capacity and computes the bin plan + extra-bin fee using
 * the canteen's slot_control settings.
 *
 * Response shape:
 * {
 *   slot_available: boolean,
 *   slot_full: boolean,
 *   slot_orders_used: number,
 *   slot_capacity: { maxOrdersPerSlot, batchedPreparedCap, madeToOrderCap, ... },
 *   bin_plan: BinPlan,
 *   requires_extra_bin: boolean,
 *   extra_fee_paise: number,
 *   meals_per_bin: number,
 *   snacks_per_bin: number
 * }
 */
export async function POST(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: CartCheckBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { canteen_id, slot, items } = body;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!canteen_id) return Response.json({ error: "canteen_id is required" }, { status: 400 });
  if (!UUID_RE.test(canteen_id)) return Response.json({ error: "canteen_id must be a valid UUID" }, { status: 400 });
  if (!slot)       return Response.json({ error: "slot is required" }, { status: 400 });
  if (!Array.isArray(items) || items.length === 0) {
    return Response.json({ error: "items must be a non-empty array" }, { status: 400 });
  }
  for (const it of items) {
    if (!it || typeof it.id !== "string" || !UUID_RE.test(it.id)) {
      return Response.json({ error: "items[].id must be a valid UUID" }, { status: 400 });
    }
  }

  const supabase = createAdminClient();

  // 1. Load slot_control for this canteen (caps + per-bin limits).
  // Lazily provisions defaults for older canteens that pre-date Phase-1 — without
  // this, students hit "Slot control not configured" 404 on the live cart flow.
  const sc = await ensureSlotControl(supabase, canteen_id);
  if (!sc) return Response.json({ error: "Slot control not configured for this canteen" }, { status: 500 });

  const capacity = computeSlotCapacity(Number(sc.max_bins));

  // 2. Load menu items in cart to get name + is_meal flags
  const ids = items.map(i => i.id);
  let menuRows: Array<Record<string, unknown>> | null = null;
  let menuErr: { message: string } | null = null;
  for (const cols of [
    "id, name, is_meal, canteen_id, availability_type, quantity_per_slot, total_per_day",
    "id, name, is_meal, canteen_id",
  ]) {
    const q = await supabase
      .from("menu_items")
      .select(cols)
      .in("id", ids);
    if (!q.error) {
      menuRows = (q.data ?? []) as unknown as Array<Record<string, unknown>>;
      menuErr = null;
      break;
    }
    menuErr = { message: q.error.message };
    if (!/column .* does not exist/i.test(q.error.message)) break;
  }
  if (menuErr) return Response.json({ error: menuErr.message }, { status: 500 });

  const menuById = new Map<string, {
    id: string;
    name: string;
    is_meal: boolean;
    canteen_id: string;
    availability_type?: string | null;
    quantity_per_slot?: number | null;
    total_per_day?: number | null;
  }>();
  for (const m of menuRows ?? []) {
    menuById.set(String(m.id), m as {
      id: string;
      name: string;
      is_meal: boolean;
      canteen_id: string;
      availability_type?: string | null;
      quantity_per_slot?: number | null;
      total_per_day?: number | null;
    });
  }

  // Validate every cart item belongs to this canteen
  for (const it of items) {
    const m = menuById.get(it.id);
    if (!m) return Response.json({ error: `Menu item not found: ${it.id}` }, { status: 400 });
    if (m.canteen_id !== canteen_id) {
      return Response.json({ error: `Item ${m.name} does not belong to this canteen` }, { status: 400 });
    }
    if (!Number.isFinite(it.quantity) || it.quantity <= 0) {
      return Response.json({ error: `Invalid quantity for ${m.name}` }, { status: 400 });
    }
  }

  const cartLines: CartLine[] = items.map(it => {
    const m = menuById.get(it.id)!;
    return { itemId: it.id, name: m.name, quantity: it.quantity, isMeal: !!m.is_meal };
  });

  // Item-level cap checks (slot/day) so carts are blocked before payment.
  // If this deployment doesn't expose cap columns yet, skip the usage query
  // and preserve legacy behavior.
  const needsCapValidation = items.some((it) => {
    const m = menuById.get(it.id);
    if (!m) return false;
    const slotCap = Number(m.quantity_per_slot ?? 0);
    const dayCap = Number(m.total_per_day ?? 0);
    return slotCap > 0 || dayCap > 0;
  });
  const usage = needsCapValidation
    ? await getMenuItemUsageForToday(supabase, {
        canteenId: canteen_id,
        menuItemIds: ids,
        slotLabel: slot,
      })
    : { dayUsed: new Map<string, number>(), slotUsed: new Map<string, number>() };
  for (const it of items) {
    const m = menuById.get(it.id);
    if (!m) continue;
    const avail = m.availability_type ?? "slot_based";
    const slotCap = Number(m.quantity_per_slot ?? 0);
    const dayCap = Number(m.total_per_day ?? 0);
    const slotUsed = usage.slotUsed.get(it.id) ?? 0;
    const dayUsed = usage.dayUsed.get(it.id) ?? 0;
    if (avail === "slot_based" && slotCap > 0 && slotUsed + it.quantity > slotCap) {
      return Response.json({
        error: `${m.name} limit reached for this slot (${slotCap}).`,
        item_id: it.id,
      }, { status: 409 });
    }
    if (avail === "batched_prepared" && dayCap > 0 && dayUsed + it.quantity > dayCap) {
      return Response.json({
        error: `${m.name} is sold out for today (${dayCap}).`,
        item_id: it.id,
      }, { status: 409 });
    }
  }

  const mealsPerBin  = Number(sc.meals_per_bin)  || 1;
  const snacksPerBin = Number(sc.snacks_per_bin) || 3;

  // Extra bin fee: slot_control is the admin-configurable setting; platform_charges
  // is a global override but only when explicitly set to > 0 (0 means "not configured").
  const { data: pcRow } = await supabase.from("platform_charges").select("extra_bin_fee_paise").limit(1).maybeSingle();
  const extraBinFeePaise = (pcRow?.extra_bin_fee_paise != null && Number(pcRow.extra_bin_fee_paise) > 0)
    ? Number(pcRow.extra_bin_fee_paise)
    : (Number(sc.extra_bin_fee_paise) || 200);

  // 3. Find orders already placed for this slot today (bin-aware capacity check)
  // Prod schema drift: orders has `slot_label` (or legacy `pickup_slot`).
  const utcNow = new Date();
  const todayIST = new Date(utcNow.getTime() + 330 * 60000).toISOString().slice(0, 10);
  const slotCols = ["slot_label", "pickup_slot", "slot"] as const;
  let existingOrders: Array<{ id: string }> | null = null;
  let lastErr: string | null = null;
  for (const col of slotCols) {
    const { data, error } = await supabase
      .from("orders")
      .select("id")
      .eq("canteen_id", canteen_id)
      .eq(col, slot)
      .gte("created_at", `${todayIST}T00:00:00+05:30`)
      .not("status", "in", '("cancelled")');
    if (!error) { existingOrders = (data ?? []) as Array<{ id: string }>; lastErr = null; break; }
    lastErr = error.message;
    if (!/column .* does not exist|undefined column/i.test(error.message)) break;
  }
  if (existingOrders === null) {
    return Response.json({ error: lastErr ?? "Failed to load orders" }, { status: 500 });
  }

  const slotOrdersUsed = existingOrders.length;

  // Count actual bins consumed by existing orders using the same packing logic.
  // Each order may occupy multiple bins depending on meals+snacks, so counting
  // orders would under-report usage (e.g. 1 order with 10 items = 2 bins).
  let existingBinsUsed = 0;
  if (existingOrders.length > 0) {
    const existingOrderIds = existingOrders.map((o) => o.id);

    // Fetch items, tolerating absence of cancelled_quantity
    type ItemRow = { order_id: string; menu_item_id: string; quantity: number; cancelled_quantity?: number | null };
    let existingItemRows: ItemRow[] = [];
    for (const cols of [
      "order_id, menu_item_id, quantity, cancelled_quantity",
      "order_id, menu_item_id, quantity",
    ]) {
      const { data: rows, error: rowErr } = await supabase
        .from("order_items")
        .select(cols)
        .in("order_id", existingOrderIds);
      if (!rowErr) { existingItemRows = (rows ?? []) as unknown as ItemRow[]; break; }
      if (!/column .* does not exist/i.test(rowErr.message)) break;
    }

    if (existingItemRows.length > 0) {
      // Get is_meal for the referenced menu items
      const existingMenuIds = [...new Set(existingItemRows.map((r) => r.menu_item_id))];
      const { data: mealRows } = await supabase
        .from("menu_items")
        .select("id, is_meal")
        .in("id", existingMenuIds);
      const isMealMap = new Map<string, boolean>(
        ((mealRows ?? []) as Array<{ id: string; is_meal: boolean | null }>)
          .map((m) => [String(m.id), !!m.is_meal])
      );

      // Group by order, compute bin plan per order, sum bin counts
      const linesPerOrder = new Map<string, CartLine[]>();
      for (const row of existingItemRows) {
        const net = Math.max(0, Number(row.quantity ?? 0) - Number(row.cancelled_quantity ?? 0));
        if (net <= 0) continue;
        const oid = String(row.order_id);
        if (!linesPerOrder.has(oid)) linesPerOrder.set(oid, []);
        linesPerOrder.get(oid)!.push({
          itemId: String(row.menu_item_id),
          name: "",
          quantity: net,
          isMeal: isMealMap.get(String(row.menu_item_id)) ?? false,
        });
      }
      for (const lines of linesPerOrder.values()) {
        existingBinsUsed += assignBins(lines, mealsPerBin, snacksPerBin, 0).bins.length;
      }
    } else {
      // Fallback: treat each order as 1 bin (better than 0)
      existingBinsUsed = existingOrders.length;
    }
  }

  // 4. Compute bin plan for the new cart
  const binPlan = assignBins(cartLines, mealsPerBin, snacksPerBin, extraBinFeePaise);

  const binsNeeded = binPlan.bins.length;
  const totalBinsAfterOrder = existingBinsUsed + binsNeeded;
  const slotFull = totalBinsAfterOrder > capacity.maxBins;

  // Check made-to-order vs batched-prepared split
  let slotFullByType = false;
  let availabilityMessage = "";
  if (!slotFull && slot) {
    const slotUsage = await getSlotAvailabilityUsage(supabase, canteen_id, slot);
    const thisMadeToOrder = cartLines
      .filter((l) => menuById.get(l.itemId)?.availability_type !== "batched_prepared")
      .reduce((sum, l) => sum + l.quantity, 0);
    const thisBatchedPrepared = cartLines
      .filter((l) => menuById.get(l.itemId)?.availability_type === "batched_prepared")
      .reduce((sum, l) => sum + l.quantity, 0);

    if (slotUsage.madeToOrderUsed + thisMadeToOrder > capacity.madeToOrderCap) {
      slotFullByType = true;
      availabilityMessage = `Made-to-order capacity full for this slot`;
    } else if (slotUsage.batchedPreparedUsed + thisBatchedPrepared > capacity.batchedPreparedCap) {
      slotFullByType = true;
      availabilityMessage = `Batched item capacity full for this slot`;
    }
  }

  // Fields used by the client to render precise partial-fit warnings:
  //   bins_needed       — how many bins THIS cart wants
  //   bins_available    — how many bins are still free in this slot
  //   partial_fit       — true when bins_needed > bins_available but the slot
  //                       isn't completely empty (i.e. some bins fit but not
  //                       all). The student should either reduce the order
  //                       to bins_available items or pick another slot.
  const binsNeededForCart = binPlan.bins.length;
  const binsAvailableInSlot = Math.max(0, capacity.maxBins - existingBinsUsed);
  const partialFit = binsNeededForCart > binsAvailableInSlot && binsAvailableInSlot > 0;

  return Response.json({
    slot_available: !slotFull && !slotFullByType,
    slot_full: slotFull || slotFullByType,
    slot_bins_used: existingBinsUsed,
    slot_orders_used: slotOrdersUsed,
    bins_needed: binsNeededForCart,
    bins_available: binsAvailableInSlot,
    partial_fit: partialFit,
    availability_message: availabilityMessage,
    slot_capacity: capacity,
    bin_plan: binPlan,
    requires_extra_bin: binPlan.bins.length > 1,
    extra_fee_paise: binPlan.extraFeePaise,
    meals_per_bin: mealsPerBin,
    snacks_per_bin: snacksPerBin,
  });
}
