import { NextRequest } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";
import { recordPaymentIdempotent } from "@/lib/paymentLedger";

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

  // ── SERVER-SIDE PRICE CALCULATION ────────────────────────────────────────
  // Fetch authoritative prices from the database — never trust client-supplied prices.
  const itemIds = [...new Set(cartItems.map((i: { id: string }) => i.id))];
  const { data: menuRows, error: menuErr } = await supabase
    .from("menu_items")
    .select("id, price, is_available, canteen_id")
    .in("id", itemIds)
    .eq("canteen_id", canteenId);

  if (menuErr) {
    return Response.json({ error: "Failed to verify menu prices" }, { status: 500 });
  }

  const menuMap = new Map((menuRows ?? []).map((m: { id: string; price: number; is_available: boolean; canteen_id: string }) => [m.id, m]));

  // Build verified order items and compute server-authoritative total
  const verifiedItems: { menu_item_id: string; quantity: number; unit_price: number }[] = [];
  let serverTotal = 0;

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
    serverTotal += menuItem.price * qty;
  }

  // Round to 2 decimal places to avoid floating-point accumulation
  serverTotal = Math.round(serverTotal * 100) / 100;

  // Generate 4-digit OTP
  const otp = String(Math.floor(1000 + Math.random() * 9000));

  // Pick an available bin for this canteen
  const { data: bins } = await supabase
    .from("bins")
    .select("id, bin_code, color")
    .eq("canteen_id", canteenId)
    .eq("is_occupied", false)
    .order("bin_code")
    .limit(1);

  const bin = bins?.[0] ?? null;
  const binLabel = bin?.bin_code ?? String(Math.floor(Math.random() * 8) + 1);
  const binColor = bin?.color ?? ["red", "blue", "green", "yellow"][Math.floor(Math.random() * 4)];

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
      bin_id: bin?.id ?? null,
      bin_label: binLabel,
      bin_color: binColor,
      slot_label: slotLabel ? String(slotLabel).slice(0, 100) : null,
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

  // Mark bin as occupied
  if (bin) {
    await supabase
      .from("bins")
      .update({ is_occupied: true, order_id: order.id, updated_at: new Date().toISOString() })
      .eq("id", bin.id);
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

  return Response.json({ orderId: order.id, otp, binLabel, binColor, total: serverTotal });
}
