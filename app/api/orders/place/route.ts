import { NextRequest } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";
import { recordPaymentIdempotent } from "@/lib/paymentLedger";
import { checkRateLimit, clientKey } from "@/lib/rateLimit";
import { assignBins, computeSlotCapacity, type CartLine, type SlotMode } from "@/lib/slotCapacity";
import { ensureSlotControl } from "@/lib/slotControlEnsure";
import { getMenuItemUsageForToday, getSlotAvailabilityUsage } from "@/lib/menuItemCapacity";

export const dynamic = "force-dynamic";

const MAX_CART_ITEMS = 20; // prevent DoS via oversized payloads
const RZP_PAYMENT_RE = /^pay_[A-Za-z0-9]{14,}$/;
const RZP_ORDER_RE   = /^order_[A-Za-z0-9]{14,}$/;

function missingColumn(errorMessage: string): string | null {
  const m = errorMessage.match(/column\s+"?([a-zA-Z0-9_\.]+)"?\s+does not exist/i);
  if (!m) return null;
  const raw = m[1].split(".").pop() ?? m[1];
  return raw.replace(/"/g, "");
}

export async function POST(req: NextRequest) {
  // Authenticate caller
  const context = await getRequestContext(req);
  if (!context) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit: a real student places at most ~5 orders/hour. 10/min is
  // generous enough for double-tap retries but blocks runaway loops.
  const rl = checkRateLimit(`orders:${clientKey(req, context.uid)}`, { limit: 10, windowMs: 60_000 });
  if (!rl.allowed) {
    return Response.json({ error: rl.message }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
  }

  const body = await req.json().catch(() => null);
  if (!body) return Response.json({ error: "Invalid body" }, { status: 400 });

  const { canteenId, cartItems, slotLabel, paymentId, razorpayOrderId, razorpaySignature } = body;
  // NOTE: `total` is intentionally NOT trusted from client — we recalculate server-side

  if (!canteenId || typeof canteenId !== "string" || canteenId.length > 100) {
    return Response.json({ error: "Missing or invalid canteenId" }, { status: 400 });
  }
  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    return Response.json({ error: "Cart is empty" }, { status: 400 });
  }
  if (cartItems.length > MAX_CART_ITEMS) {
    return Response.json({ error: `Cart cannot exceed ${MAX_CART_ITEMS} items` }, { status: 400 });
  }
  if (slotLabel != null) {
    const SLOT_LABEL_RE = /^\d{1,2}:\d{2}\s*(AM|PM)\s*-\s*\d{1,2}:\d{2}\s*(AM|PM)$/i;
    if (typeof slotLabel !== "string" || !SLOT_LABEL_RE.test(slotLabel.trim())) {
      return Response.json({ error: "Invalid slot label format" }, { status: 400 });
    }
  }

  // Validate every cart item has a string id and positive integer qty
  for (const item of cartItems) {
    if (!item?.id || typeof item.id !== "string") {
      return Response.json({ error: "Invalid cart item: missing id" }, { status: 400 });
    }
    const qty = Number(item.qty);
    if (!Number.isInteger(qty) || qty < 1) {
      return Response.json({ error: "Invalid item quantity" }, { status: 400 });
    }
  }

  const supabase = createAdminClient();

  // ── SERVER-SIDE PRICE + BIN PLAN CALCULATION ─────────────────────────────
  // Fetch authoritative prices AND `is_meal` flags from the database — we
  // never trust client-supplied prices, and we re-run bin packing here so
  // the extra-bin fee can't be tampered with at checkout.
  const itemIds = [...new Set(cartItems.map((i: { id: string }) => i.id))];
  // Pre-validate UUID shape: a stray "fake" id would otherwise cause
  // Postgres to throw `22P02 invalid_text_representation`, which surfaces
  // as a misleading 500. Reject malformed ids as a client error up-front.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const id of itemIds) {
    if (!UUID_RE.test(id)) {
      return Response.json({ error: `Invalid item id "${id}"` }, { status: 400 });
    }
  }
  const selectCols = [
    "id", "name", "price", "is_available", "is_meal", "canteen_id",
    "availability_type", "quantity_per_slot", "total_per_day",
  ];
  let menuRows: Array<Record<string, unknown>> | null = null;
  let menuErr: { message: string; code?: string } | null = null;
  for (let attempt = 0; attempt < 8 && selectCols.length > 0; attempt++) {
    const q = await supabase
      .from("menu_items")
      .select(selectCols.join(", "))
      .in("id", itemIds)
      .eq("canteen_id", canteenId);
    if (!q.error) {
      menuRows = (q.data ?? []) as unknown as Array<Record<string, unknown>>;
      menuErr = null;
      break;
    }
    menuErr = { message: q.error.message, code: (q.error as { code?: string }).code };
    const miss = missingColumn(q.error.message);
    if (!miss) break;
    const idx = selectCols.findIndex((c) => c === miss);
    if (idx < 0) break;
    selectCols.splice(idx, 1);
  }

  if (menuErr) {
    // Postgres invalid_text_representation (22P02) means the client sent a
    // value the column type can't parse — that's a 400, not a 500.
    const code = (menuErr as { code?: string }).code;
    if (code === "22P02") {
      return Response.json({ error: "Invalid item id format" }, { status: 400 });
    }
    return Response.json({ error: "Failed to verify menu prices" }, { status: 500 });
  }

  const menuMap = new Map(
    (menuRows ?? []).map((m) => [String(m.id), {
      id: String(m.id),
      name: String(m.name ?? ""),
      price: Number(m.price ?? 0),
      is_available: Boolean(m.is_available),
      is_meal: (m.is_meal as boolean | null) ?? null,
      canteen_id: String(m.canteen_id ?? ""),
      availability_type: (m.availability_type as string | null) ?? null,
      quantity_per_slot: m.quantity_per_slot == null ? null : Number(m.quantity_per_slot),
      total_per_day: m.total_per_day == null ? null : Number(m.total_per_day),
    }])
  );

  // Build verified order items and compute server-authoritative subtotal
  const verifiedItems: { menu_item_id: string; quantity: number; unit_price: number }[] = [];
  const cartLines: CartLine[] = [];
  let serverSubtotal = 0;

  for (const item of cartItems) {
    const menuItem = menuMap.get(item.id);
    if (!menuItem) {
      return Response.json({ error: `Item "${item.id}" not found in this canteen's menu` }, { status: 400 });
    }
    if (menuItem.is_available === false) {
      return Response.json({ error: "One or more items are currently unavailable" }, { status: 400 });
    }
    const qty = Number(item.qty);
    verifiedItems.push({ menu_item_id: item.id, quantity: qty, unit_price: menuItem.price });
    // null is_meal → treat as meal (1 per bin) — safer default than snack (5 per bin)
    cartLines.push({ itemId: item.id, name: menuItem.name, quantity: qty, isMeal: menuItem.is_meal !== false });
    serverSubtotal += menuItem.price * qty;
  }

  // Find matching time slot
  const slotName = slotLabel ? String(slotLabel).split(" ")[0] : "";
  const { data: slotRows } = slotName
    ? await supabase
        .from("time_slots")
        .select("id, start_time")
        .eq("canteen_id", canteenId)
        .ilike("slot_name", `%${slotName}%`)
        .limit(1)
    : { data: null };
  const slotId = slotRows?.[0]?.id ?? null;
  const slotStart = slotRows?.[0]?.start_time as string | undefined;

  // Enforce per-item caps (slot-based or daily-batch) before allocating bins.
  const usage = await getMenuItemUsageForToday(supabase, {
    canteenId,
    menuItemIds: itemIds,
    slotId,
    slotLabel: slotLabel ? String(slotLabel) : null,
  });
  for (const item of cartItems as Array<{ id: string; qty: number }>) {
    const menuItem = menuMap.get(item.id);
    if (!menuItem) continue;
    const qty = Number(item.qty);
    const avail = menuItem.availability_type ?? "slot_based";
    const slotCap = Number(menuItem.quantity_per_slot ?? 0);
    const dayCap = Number(menuItem.total_per_day ?? 0);
    const slotUsed = usage.slotUsed.get(item.id) ?? 0;
    const dayUsed = usage.dayUsed.get(item.id) ?? 0;
    if (avail === "slot_based" && slotCap > 0 && slotUsed + qty > slotCap) {
      return Response.json({
        error: `${menuItem.name} limit reached for this slot (${slotCap}).`,
      }, { status: 409 });
    }
    if (avail === "batched_prepared" && dayCap > 0 && dayUsed + qty > dayCap) {
      return Response.json({
        error: `${menuItem.name} is sold out for today (${dayCap}).`,
      }, { status: 409 });
    }
  }

  // ── Slot control (fetched once, reused for cap + bin plan + cutoff) ─────
  const sc = await ensureSlotControl(supabase, canteenId);
  // maxOrdersPerSlot is derived from the canteen manager's max_bins setting
  // via computeSlotCapacity (100% capacity). Canteen managers control this through
  // the Slot & Bin Control panel — changing max_bins changes the cap in real time.
  const maxBins = Number(sc?.max_bins) || 60;
  const slotMode = ((sc as Record<string, unknown>)?.slot_mode as SlotMode | undefined) ?? 'both';
  const { maxOrdersPerSlot, batchedPreparedCap, madeToOrderCap } = computeSlotCapacity(maxBins, slotMode);

  // ── MADE-TO-ORDER vs BATCHED-PREPARED SPLIT (enforce slot-level caps) ────
  // Split: 60% for batched/prepared, 40% for made-to-order.
  // Enforce this split so concurrent orders can't exhaust one type.
  if (slotLabel) {
    const slotUsage = await getSlotAvailabilityUsage(supabase, canteenId, String(slotLabel));
    const thisMadeToOrder = cartLines.filter((l) => {
      const item = menuMap.get(l.itemId);
      return item && (item.availability_type ?? "slot_based") === "slot_based";
    }).reduce((sum, l) => sum + l.quantity, 0);
    const thisBatchedPrepared = cartLines.filter((l) => {
      const item = menuMap.get(l.itemId);
      return item && (item.availability_type ?? "slot_based") === "batched_prepared";
    }).reduce((sum, l) => sum + l.quantity, 0);

    if (slotUsage.madeToOrderUsed + thisMadeToOrder > madeToOrderCap) {
      return Response.json({
        error: `Made-to-order capacity full for this slot (${madeToOrderCap} total). Try a different time slot.`,
      }, { status: 409 });
    }
    if (slotUsage.batchedPreparedUsed + thisBatchedPrepared > batchedPreparedCap) {
      return Response.json({
        error: `Batched item capacity full for this slot (${batchedPreparedCap} total). Try a different time slot.`,
      }, { status: 409 });
    }
  }

  const todayIST = new Date(new Date().getTime() + 330 * 60_000)
    .toISOString()
    .slice(0, 10);

  // ── PER-SLOT ORDER CAP (server-side gate) ────────────────────────────────
  // /api/cart/check is a pre-flight UI guard; this check enforces the cap
  // server-side so concurrent requests can't race past the UI. Without it,
  // two requests that both read "slot available" can both succeed and drive
  // the slot past 75% capacity, exhausting the shared physical bin pool.
  if (slotLabel) {
    const { count: slotCount } = await supabase
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("canteen_id", canteenId)
      .eq("slot_label", String(slotLabel))
      .gte("created_at", `${todayIST}T00:00:00+05:30`)
      .not("status", "in", '("cancelled","failed","refunded")');
    if ((slotCount ?? 0) >= maxOrdersPerSlot) {
      return Response.json(
        { error: "This time slot is full. Please select a different slot.", slot_full: true },
        { status: 409 },
      );
    }
  }

  // ── Compute bin plan + extra-bin fee ────────────────────────────────────
  // Extra bin fee is a global platform setting (platform_charges table).
  // Fall back to slot_control.extra_bin_fee_paise for legacy rows, then 200 paise.
  const { data: pcRow } = await supabase
    .from("platform_charges")
    .select("extra_bin_fee_paise")
    .limit(1)
    .maybeSingle();
  const extraFeePaise0 = pcRow?.extra_bin_fee_paise != null
    ? Number(pcRow.extra_bin_fee_paise)
    : (sc?.extra_bin_fee_paise != null ? Number(sc.extra_bin_fee_paise) : 200);

  const mealsPerBin          = 1;
  const snacksWithMealPerBin = Number(sc?.snacks_per_bin) || 3;
  const binPlan = assignBins(cartLines, mealsPerBin, snacksWithMealPerBin, extraFeePaise0);

  const extraBinFeeRupees = Math.round(binPlan.extraFeePaise) / 100;
  // 5% food GST (2.5% CGST + 2.5% SGST) — disabled in staging via DISABLE_GST=true
  const gstDisabled = process.env.DISABLE_GST === "true";
  const gstAmount = gstDisabled ? 0 : Math.round(serverSubtotal * 0.05 * 100) / 100;
  let serverTotal = serverSubtotal + gstAmount + extraBinFeeRupees;
  // Round to 2 decimal places to avoid floating-point accumulation
  serverTotal = Math.round(serverTotal * 100) / 100;

  // Generate 4-digit OTP
  const otp = String(Math.floor(1000 + Math.random() * 9000));

  // Bin plan tells us how many bins this order will need (for bin_count).
  // Physical bins are NOT claimed at order time — they are deferred until
  // the slot's start time arrives (see lib/deferredBinAssign.ts).
  const binsNeeded = binPlan.bins.length;

  // ── Order cutoff (PDF requirement) ───────────────────────────────────────
  // A slot closes for new orders one slot_duration BEFORE its start time.
  //   e.g. 1:00 PM slot with 15-min duration → cutoff is 12:45 PM.
  // We compare wall-clock minutes-of-day in the canteen's local timezone
  // (server is UTC; time_slots.start_time is "HH:MM:SS" in local time).
  if (slotId && slotStart) {
    const durMins = Number(sc?.slot_duration_mins) || 15;
    const [sh, sm] = slotStart.split(":").map(Number);
    const slotStartMin = sh * 60 + sm;
    const cutoffMin = slotStartMin - durMins;
    // Treat current time in IST (Asia/Kolkata, UTC+5:30) — the canteen tz.
    const nowUtc = new Date();
    const istMin = (nowUtc.getUTCHours() * 60 + nowUtc.getUTCMinutes() + 330) % 1440;
    if (istMin > cutoffMin) {
      return Response.json({
        error: `Slot has closed for new orders. Orders for the ${slotStart.slice(0,5)} slot had to be placed by ${String(Math.floor(cutoffMin / 60)).padStart(2,"0")}:${String(cutoffMin % 60).padStart(2,"0")}.`,
      }, { status: 400 });
    }
  }

  // ── Create the order (no bin assigned yet — deferred until slot time) ──────
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      user_id: context.uid,
      canteen_id: canteenId,
      total_amount: serverTotal,
      status: "placed",
      otp,
      payment_id: (typeof paymentId === "string" && paymentId.length <= 100) ? paymentId : null,
      slot_id: slotId,
      bin_id: null,
      bin_label: null,
      bin_color: null,
      slot_label: slotLabel ? String(slotLabel).slice(0, 100) : null,
      bin_count: binsNeeded,
      extra_bin_fee_paise: binPlan.extraFeePaise,
    })
    .select("id")
    .single();

  if (orderError || !order) {
    return Response.json({ error: "Failed to create order" }, { status: 500 });
  }

  // ── POST-CREATION CAPACITY CHECK (atomic race condition guard) ──────────────
  if (slotLabel) {
    const { count: slotCountAfter } = await supabase
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("canteen_id", canteenId)
      .eq("slot_label", String(slotLabel))
      .gte("created_at", `${todayIST}T00:00:00+05:30`)
      .not("status", "in", '("cancelled","failed","refunded")');

    if ((slotCountAfter ?? 0) > maxOrdersPerSlot) {
      await supabase.from("orders").delete().eq("id", order.id);
      return Response.json({
        error: "This time slot is full. Please select a different slot.",
        slot_full: true,
      }, { status: 409 });
    }
  }

  // Insert order items with server-verified prices
  if (verifiedItems.length > 0) {
    await supabase.from("order_items").insert(
      verifiedItems.map(item => ({
        order_id: order.id,
        menu_item_id: item.menu_item_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
      }))
    );
  }

  // ── Audit-ledger entry for the Razorpay capture ─────────────────────────
  if (
    typeof paymentId === "string" && RZP_PAYMENT_RE.test(paymentId) &&
    typeof razorpayOrderId === "string" && RZP_ORDER_RE.test(razorpayOrderId)
  ) {
    try {
      await recordPaymentIdempotent({
        razorpay_order_id:   razorpayOrderId,
        razorpay_payment_id: paymentId,
        razorpay_signature:  typeof razorpaySignature === "string" ? razorpaySignature.slice(0, 200) : null,
        order_id:            order.id,
        user_id:             context.uid,
        canteen_id:          canteenId,
        amount_paise:        Math.round(serverTotal * 100),
        status:              "captured",
      });
    } catch (e) {
      console.error("[orders/place] payment-ledger insert failed:", e);
    }
  }

  // Bin label is deferred — student order-status page already shows
  // "Bin and OTP will appear when ready" until the status moves to ready_for_pickup.
  return Response.json({
    orderId: order.id,
    otp,
    binLabel: null,
    binCode:  null,
    binColor: null,
    total:    serverTotal,
    extraBinFeePaise: binPlan.extraFeePaise,
    binCount: binsNeeded,
    bins:     [],
  });
}
