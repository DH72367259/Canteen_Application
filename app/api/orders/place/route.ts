import { NextRequest } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";
import { recordPaymentIdempotent } from "@/lib/paymentLedger";
import { checkRateLimit, clientKey } from "@/lib/rateLimit";
import { assignBins, computeSlotCapacity, type CartLine, type BinAssignment } from "@/lib/slotCapacity";
import { ensureSlotControl } from "@/lib/slotControlEnsure";
import { getMenuItemUsageForToday, getSlotAvailabilityUsage } from "@/lib/menuItemCapacity";
import { claimFreeBinsAtomic } from "@/lib/atomicBinClaim";

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
    cartLines.push({ itemId: item.id, name: menuItem.name, quantity: qty, isMeal: !!menuItem.is_meal });
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
  const maxBins          = Number(sc?.max_bins) || 60;
  const { maxOrdersPerSlot, batchedPreparedCap, madeToOrderCap } = computeSlotCapacity(maxBins);

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

  // ── Compute bin plan + extra-bin fee from canteen settings ───────────────
  const mealsPerBin    = Number(sc?.meals_per_bin)        || 2;
  const snacksPerBin   = Number(sc?.snacks_per_bin)       || 5;
  const extraFeePaise0 = Number(sc?.extra_bin_fee_paise)  || 200;
  const binPlan = assignBins(cartLines, mealsPerBin, snacksPerBin, extraFeePaise0);

  const extraBinFeeRupees = Math.round(binPlan.extraFeePaise) / 100;
  let serverTotal = serverSubtotal + extraBinFeeRupees;
  // Round to 2 decimal places to avoid floating-point accumulation
  serverTotal = Math.round(serverTotal * 100) / 100;

  // Generate 4-digit OTP
  const otp = String(Math.floor(1000 + Math.random() * 9000));

  // ── Allocate N free bins (one per binPlan.bins entry) ────────────────────
  // Prod canteens have many physical bins per slot; if the canteen is so
  // saturated that there aren't enough free bins, fail loudly so the user
  // can pick a different slot rather than silently losing items.
  const binsNeeded = binPlan.bins.length;
  // Pull the entire free bin pool ordered by colour-zone then bin number so
  // we can hand out same-colour ADJACENT bins for multi-bin orders ("Place
  // Part 1 in #RED004, Part 2 in #RED005"). Falls back to any free bins if
  // no contiguous run exists.
  const { data: freeBins } = await supabase
    .from("bins")
    .select("id, bin_code, color, zone_color, bin_number")
    .eq("canteen_id", canteenId)
    .eq("is_occupied", false)
    .order("zone_color", { ascending: true })
    .order("bin_number", { ascending: true });

  type FreeBin = { id: string; bin_code: string; color: string | null; zone_color: string | null; bin_number: number | null };
  const pool = (freeBins ?? []) as FreeBin[];

  // Pick same-colour adjacent run when possible.
  function pickContiguous(n: number): FreeBin[] | null {
    if (n <= 1) return pool.length >= 1 ? [pool[0]] : null;
    const byZone = new Map<string, FreeBin[]>();
    for (const b of pool) {
      const z = (b.zone_color || b.color || "_").toLowerCase();
      if (!byZone.has(z)) byZone.set(z, []);
      byZone.get(z)!.push(b);
    }
    for (const list of byZone.values()) {
      list.sort((a, b) => (a.bin_number ?? 0) - (b.bin_number ?? 0));
      for (let i = 0; i + n <= list.length; i++) {
        let ok = true;
        for (let k = 1; k < n; k++) {
          const prev = list[i + k - 1].bin_number ?? -1;
          const cur  = list[i + k].bin_number ?? -2;
          if (cur !== prev + 1) { ok = false; break; }
        }
        if (ok) return list.slice(i, i + n);
      }
    }
    return null;
  }

  const allocated: FreeBin[] = pickContiguous(binsNeeded) ?? pool.slice(0, binsNeeded);
  if (allocated.length < binsNeeded) {
    // Reject orders when there aren't enough configured bins available.
    // Check total bins configured for this canteen to distinguish between
    // "no bins in test canteen" vs "no free bins during peak load".
    const { count: totalBinsCount } = await supabase
      .from("bins")
      .select("*", { count: "exact", head: true })
      .eq("canteen_id", canteenId);

    const hasNoConfiguredBins = (totalBinsCount ?? 0) === 0;

    if (binsNeeded === 1 && allocated.length === 0 && hasNoConfiguredBins) {
      // Test data: synth a placeholder ONLY if canteen has ZERO bins configured
      allocated.push({
        id: "",
        bin_code: "SYNTH-001",
        color: "blue",
        zone_color: null,
        bin_number: null,
      });
    } else if (allocated.length < binsNeeded) {
      return Response.json({
        error: `All physical bins are in use right now — workers are still clearing the previous slot. Please wait a moment and try again, or pick a different slot.`,
        bins_exhausted: true,
      }, { status: 409 });
    }
  }

  // Map BinPlan.bins[i] → allocated[i] (keep original 1-based bin_index for display)
  const firstBin = allocated[0];
  const firstBinId    = firstBin.id || null;
  const firstBinLabel = firstBin.bin_code;
  const firstBinColor = firstBin.color ?? "blue";

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

  // ── ATOMIC BIN CLAIMING ──────────────────────────────────────────────────
  // We'll claim bins AFTER creating the order so we have a real order_id.
  // First, create order with placeholder bin info (will update after claiming).
  
  // Create the order using the server-calculated total
  // (Note: bin_id, bin_label, bin_color are provisional from first allocated bin;
  //  we'll update them after atomically claiming the actual physical bins)
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
      bin_id: firstBinId,
      bin_label: firstBinLabel,
      bin_color: firstBinColor,
      slot_label: slotLabel ? String(slotLabel).slice(0, 100) : null,
      // Phase 7 rollups (older DBs without these columns will still accept the insert
      // because Supabase ignores unknown columns when using the admin client only if
      // the column exists — if not, the migration must be applied. See phase7_extra_bin_workflow.sql).
      bin_count: binsNeeded,
      extra_bin_fee_paise: binPlan.extraFeePaise,
    })
    .select("id")
    .single();

  if (orderError || !order) {
    return Response.json({ error: "Failed to create order" }, { status: 500 });
  }

  // ── POST-CREATION CAPACITY CHECK (atomic race condition guard) ──────────────
  // Even though we checked capacity before creating the order, concurrent requests
  // can both read count=N, both pass, and both create. Verify again now that the
  // order exists. If we've exceeded capacity, delete this order and reject.
  if (slotLabel) {
    const { count: slotCountAfter } = await supabase
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("canteen_id", canteenId)
      .eq("slot_label", String(slotLabel))
      .gte("created_at", `${todayIST}T00:00:00+05:30`)
      .not("status", "in", '("cancelled","failed","refunded")');

    if ((slotCountAfter ?? 0) > maxOrdersPerSlot) {
      // Exceeded capacity — delete this order and reject
      await supabase.from("orders").delete().eq("id", order.id);
      return Response.json({
        error: "This time slot is full. Please select a different slot.",
        slot_full: true,
      }, { status: 409 });
    }
  }

  // Step 2: Atomically claim N free bins for this order using the real order_id.
  // This uses a single UPDATE with WHERE is_occupied=false to prevent race conditions
  // where two concurrent requests could claim the same bin.
  const allocatedIds = allocated.map(b => b.id).filter((x): x is string => !!x);
  let claimedBinIds: string[] = [];
  
  if (allocatedIds.length > 0) {
    // ✅ CRITICAL FIX: Pass slotLabel to prevent slot A orders from stealing slot B bins
    const claimResult = await claimFreeBinsAtomic(canteenId, allocatedIds, order.id, binsNeeded, slotLabel);
    if (!claimResult.success) {
      // Race condition: bin claiming failed. For single-bin orders, fall back to synthetic bin
      // to ensure the order succeeds even under high concurrency. Multi-bin orders must fail.
      if (binsNeeded === 1) {
        // Synthetic bin fallback — don't fail the order
        claimedBinIds = [""];
      } else {
        // Multi-bin order failed — mark it as failed and return 409
        await supabase
          .from("orders")
          .update({ status: "failed" })
          .eq("id", order.id);

        return Response.json({
          error: claimResult.message || "Not enough free bins available. Please try a different slot.",
          slot_full: true,
        }, { status: 409 });
      }
    } else {
      claimedBinIds = claimResult.claimedIds;
    }
  } else if (binsNeeded === 1) {
    // Synthetic bin (test data) — no need to claim
    claimedBinIds = [""];
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

  // ── Insert per-bin allocations (Phase 7) ─────────────────────────────────
  // Use claimedBinIds to match actual claimed bins, not the allocated array
  // to avoid reusing the same physical bin multiple times if claiming failed
  // for some bins
  const orderBinRows = binPlan.bins.map((b: BinAssignment, i: number) => {
    const claimedBinId = claimedBinIds[i] || null;
    // For synthetic bins or fallback cases, claimedBinId will be ""
    // Find the corresponding allocated bin for metadata (code, color)
    const phys = allocated[i] || allocated[0] || {
      id: "",
      bin_code: "FALLBACK",
      color: "blue",
      zone_color: null,
      bin_number: null,
    };
    return {
      order_id:  order.id,
      bin_id:    claimedBinId || null,  // Use claimed ID, not allocated
      bin_index: b.binIndex,
      bin_code:  phys.bin_code,
      bin_color: phys.color ?? "blue",
      items: [
        ...b.meals.map((m) => ({ name: m.name, quantity: m.quantity, isMeal: true })),
        ...b.snacks.map((s) => ({ name: s.name, quantity: s.quantity, isMeal: false })),
      ],
    };
  });
  if (orderBinRows.length > 0) {
    const { error: obErr } = await supabase.from("order_bins").insert(orderBinRows);
    if (obErr) {
      // Don't fail the whole order — log so we can investigate, but the order is
      // already paid for. Single-bin (legacy) data is still on `orders` columns.
      console.error("[orders/place] order_bins insert failed:", obErr.message);
    }
  }

  // ── Audit-ledger entry for the Razorpay capture ─────────────────────────
  // We snapshot the commission split RIGHT NOW so future tariff changes
  // never retroactively rewrite history. Idempotent on razorpay_payment_id —
  // safe even if the webhook fires before/after this. Failure here must NOT
  // fail the order (the user has already paid); we just log it.
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
      // Order is already created and paid — never bubble this to the user.
      console.error("[orders/place] payment-ledger insert failed:", e);
    }
  }

  // Build the per-bin response payload (the cart UI saves this in localStorage
  // for the order-status screen + workers see the same breakdown).
  const binsResponse = orderBinRows.map((row) => ({
    binIndex: row.bin_index,
    binLabel: row.bin_code,
    binCode:  row.bin_code,
    binColor: row.bin_color,
    items:    row.items,
  }));

  return Response.json({
    orderId: order.id,
    otp,
    binLabel: firstBinLabel,
    binCode:  firstBinLabel,
    binColor: firstBinColor,
    total:    serverTotal,
    extraBinFeePaise: binPlan.extraFeePaise,
    binCount: binsNeeded,
    bins:     binsResponse,
  });
}
