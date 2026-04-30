import { NextRequest } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";
import { recordPaymentIdempotent } from "@/lib/paymentLedger";
import { checkRateLimit, clientKey } from "@/lib/rateLimit";
import { assignBins, type CartLine, type BinAssignment } from "@/lib/slotCapacity";
import { ensureSlotControl } from "@/lib/slotControlEnsure";

export const dynamic = "force-dynamic";

const MAX_CART_ITEMS = 20; // prevent DoS via oversized payloads
const RZP_PAYMENT_RE = /^pay_[A-Za-z0-9]{14,}$/;
const RZP_ORDER_RE   = /^order_[A-Za-z0-9]{14,}$/;

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
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) {
      return Response.json({ error: "Invalid quantity in cart" }, { status: 400 });
    }
  }

  const supabase = createAdminClient();

  // ── SERVER-SIDE PRICE + BIN PLAN CALCULATION ─────────────────────────────
  // Fetch authoritative prices AND `is_meal` flags from the database — we
  // never trust client-supplied prices, and we re-run bin packing here so
  // the extra-bin fee can't be tampered with at checkout.
  const itemIds = [...new Set(cartItems.map((i: { id: string }) => i.id))];
  const { data: menuRows, error: menuErr } = await supabase
    .from("menu_items")
    .select("id, name, price, is_available, is_meal, canteen_id")
    .in("id", itemIds)
    .eq("canteen_id", canteenId);

  if (menuErr) {
    return Response.json({ error: "Failed to verify menu prices" }, { status: 500 });
  }

  const menuMap = new Map(
    (menuRows ?? []).map((m: { id: string; name: string; price: number; is_available: boolean; is_meal: boolean | null; canteen_id: string }) => [m.id, m])
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

  // ── Compute bin plan + extra-bin fee from canteen settings ───────────────
  const sc = await ensureSlotControl(supabase, canteenId);
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
    // Fall back gracefully when only one or zero bins exist (typical for a
    // freshly-seeded test canteen). Pad with synthetic placeholders so the
    // order still places — workers will physically use whatever bins are
    // available. Never error out single-bin orders for missing seed data.
    if (binsNeeded === 1 && allocated.length === 0) {
      // legacy behaviour: synth a placeholder code/color so the response shape
      // matches the original API contract
      allocated.push({
        id: "",
        bin_code: String(Math.floor(Math.random() * 8) + 1),
        color: ["red", "blue", "green", "yellow"][Math.floor(Math.random() * 4)],
        zone_color: null,
        bin_number: null,
      });
    } else if (allocated.length < binsNeeded) {
      return Response.json({
        error: `This order needs ${binsNeeded} bins but only ${allocated.length} are free right now. Please pick a different slot or reduce your cart.`,
      }, { status: 409 });
    }
  }

  // Map BinPlan.bins[i] → allocated[i] (keep original 1-based bin_index for display)
  const firstBin = allocated[0];
  const firstBinId    = firstBin.id || null;
  const firstBinLabel = firstBin.bin_code;
  const firstBinColor = firstBin.color ?? "blue";

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

  // ── Order cutoff (PDF requirement) ───────────────────────────────────────
  // A slot closes for new orders one slot_duration BEFORE its start time.
  //   e.g. 1:00 PM slot with 15-min duration → cutoff is 12:45 PM.
  // We compare wall-clock minutes-of-day in the canteen's local timezone
  // (server is UTC; time_slots.start_time is "HH:MM:SS" in local time).
  if (slotId && slotStart) {
    const { data: scRow } = await supabase
      .from("slot_control")
      .select("slot_duration_mins")
      .eq("canteen_id", canteenId)
      .single();
    const durMins = Number(scRow?.slot_duration_mins) || 15;
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

  // Create the order using the server-calculated total
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
  const orderBinRows = binPlan.bins.map((b: BinAssignment, i: number) => {
    const phys = allocated[i] ?? allocated[allocated.length - 1];
    return {
      order_id:  order.id,
      bin_id:    phys.id || null,
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

  // Mark every allocated bin as occupied + linked to this order
  const allocatedIds = allocated.map(b => b.id).filter((x): x is string => !!x);
  if (allocatedIds.length > 0) {
    // Phase 8: also stamp `assigned_order_id` and set status='reserved' so
    // the rack UI shows the bin as taken even before the worker has placed
    // the food. The worker dashboard flips status='occupied' when each part
    // is physically placed.
    await supabase
      .from("bins")
      .update({
        is_occupied: true,
        order_id: order.id,
        assigned_order_id: order.id,
        status: "reserved",
        updated_at: new Date().toISOString(),
      })
      .in("id", allocatedIds);
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
