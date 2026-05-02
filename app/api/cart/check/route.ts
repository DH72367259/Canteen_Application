import { createAdminClient } from "@/lib/supabase-server";
import { getRequestContext } from "@/lib/authServer";
import { assignBins, computeSlotCapacity, type CartLine } from "@/lib/slotCapacity";
import { ensureSlotControl } from "@/lib/slotControlEnsure";
import { getMenuItemUsageForToday } from "@/lib/menuItemCapacity";

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

  // 3. Count orders already placed for this slot today
  // Prod schema drift: orders has `slot_label` (or legacy `pickup_slot`),
  // not `slot`. Try the modern column first then fall back gracefully so
  // older deployments and dev DBs both work.
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
      .not("status", "in", '("cancelled","refunded")');
    if (!error) { existingOrders = (data ?? []) as Array<{ id: string }>; lastErr = null; break; }
    lastErr = error.message;
    // Only retry when the failure looks like a missing column.
    if (!/column .* does not exist|undefined column/i.test(error.message)) break;
  }
  if (existingOrders === null) {
    return Response.json({ error: lastErr ?? "Failed to load orders" }, { status: 500 });
  }

  const slotOrdersUsed = existingOrders.length;
  const slotFull = slotOrdersUsed >= capacity.maxOrdersPerSlot;

  // 4. Compute bin plan with this canteen's per-bin settings
  const binPlan = assignBins(
    cartLines,
    Number(sc.meals_per_bin) || 2,
    Number(sc.snacks_per_bin) || 5,
    Number(sc.extra_bin_fee_paise) || 200
  );

  return Response.json({
    slot_available: !slotFull,
    slot_full: slotFull,
    slot_orders_used: slotOrdersUsed,
    slot_capacity: capacity,
    bin_plan: binPlan,
    requires_extra_bin: binPlan.bins.length > 1,
    extra_fee_paise: binPlan.extraFeePaise,
    meals_per_bin: Number(sc.meals_per_bin) || 2,
    snacks_per_bin: Number(sc.snacks_per_bin) || 5,
  });
}
