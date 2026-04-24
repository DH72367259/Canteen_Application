import { NextRequest } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Authenticate caller
  const context = await getRequestContext(req);
  if (!context) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return Response.json({ error: "Invalid body" }, { status: 400 });

  const { canteenId, cartItems, total, slotLabel, paymentId } = body;

  if (!canteenId || !cartItems?.length || !total) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  const supabase = createAdminClient();

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
  const slotName = slotLabel ? slotLabel.split(" ")[0] : "";
  const { data: slotRows } = slotName
    ? await supabase
        .from("time_slots")
        .select("id")
        .eq("canteen_id", canteenId)
        .ilike("slot_name", `%${slotName}%`)
        .limit(1)
    : { data: null };
  const slotId = slotRows?.[0]?.id ?? null;

  // Create the order
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      user_id: context.uid,
      canteen_id: canteenId,
      total_amount: total,
      status: "placed",
      otp,
      payment_id: paymentId ?? null,
      slot_id: slotId,
      bin_id: bin?.id ?? null,
      bin_label: binLabel,
      bin_color: binColor,
      slot_label: slotLabel ?? null,
    })
    .select("id")
    .single();

  if (orderError || !order) {
    console.error("Order creation error:", orderError);
    return Response.json({ error: "Failed to create order" }, { status: 500 });
  }

  // Insert order items
  if (cartItems.length > 0) {
    await supabase.from("order_items").insert(
      cartItems.map((item: { id: string; name: string; price: number; qty: number }) => ({
        order_id: order.id,
        menu_item_id: item.id,
        quantity: item.qty,
        unit_price: item.price,
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

  return Response.json({ orderId: order.id, otp, binLabel, binColor });
}
