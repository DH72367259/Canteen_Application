import { NextRequest } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const MAX_CART_ITEMS = 20; // prevent DoS via oversized payloads

export async function POST(req: NextRequest) {
  // Authenticate caller
  const context = await getRequestContext(req);
  if (!context) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return Response.json({ error: "Invalid body" }, { status: 400 });

  const { canteenId, cartItems, slotLabel, paymentId } = body;
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
        .select("id")
        .eq("canteen_id", canteenId)
        .ilike("slot_name", `%${slotName}%`)
        .limit(1)
    : { data: null };
  const slotId = slotRows?.[0]?.id ?? null;

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

  return Response.json({ orderId: order.id, otp, binLabel, binColor, total: serverTotal });
}
