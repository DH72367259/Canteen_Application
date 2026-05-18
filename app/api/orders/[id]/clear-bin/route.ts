import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";
import { insertNotification } from "@/lib/notify";

export const dynamic = "force-dynamic";

/**
 * POST /api/orders/[id]/clear-bin
 *
 * Worker confirms they have physically removed the order from the bin
 * and placed it in the separate late-pickup counter.
 *
 * Transitions:  late_pickup_pending → late_pickup
 * Side effects: snapshots bin_label/bin_color onto the order; frees the bin.
 *
 * Only callable by canteen staff (worker, canteen_admin, vendor, co_admin, super_admin).
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await getRequestContext(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!["worker", "canteen_admin", "vendor", "co_admin", "super_admin"].includes(auth.role)) {
    return NextResponse.json({ error: "Staff only." }, { status: 403 });
  }

  const { id: orderId } = await context.params;
  const supabase = createAdminClient();

  const { data: order } = await supabase
    .from("orders")
    .select("id, status, canteen_id, bin_id, user_id")
    .eq("id", orderId)
    .single<{ id: string; status: string; canteen_id: string | null; bin_id: string | null; user_id: string | null }>();

  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  if (auth.canteenId && order.canteen_id && auth.canteenId !== order.canteen_id) {
    return NextResponse.json({ error: "Access denied." }, { status: 403 });
  }
  if (order.status !== "late_pickup_pending") {
    return NextResponse.json(
      { error: `Order is in '${order.status}' status — only late_pickup_pending orders can be cleared.` },
      { status: 400 },
    );
  }

  const nowIso = new Date().toISOString();

  // Snapshot the physical bin details before unlinking
  let binLabel: string | null = null;
  let binColor: string | null = null;

  if (order.bin_id) {
    const { data: bin } = await supabase
      .from("bins")
      .select("id, bin_code, color")
      .eq("id", order.bin_id)
      .maybeSingle<{ id: string; bin_code: string | null; color: string | null }>();
    if (bin) {
      binLabel = bin.bin_code ?? null;
      binColor  = bin.color ?? null;
    }
  }

  // Move order to late_pickup, snapshot bin info, unlink bin
  await supabase
    .from("orders")
    .update({
      status:    "late_pickup",
      bin_label: binLabel,
      bin_color: binColor,
      bin_id:    null,
      updated_at: nowIso,
    })
    .eq("id", orderId)
    .eq("status", "late_pickup_pending");

  // Free the physical bin (covers both legacy order_id and Phase-7 assigned_order_id)
  const freeBin = {
    is_occupied:        false,
    order_id:           null,
    assigned_order_id:  null,
    current_order_id:   null,
    slot_label:         null,
    status:             "empty",
    updated_at:         nowIso,
  };
  if (order.bin_id) {
    await supabase.from("bins").update(freeBin).eq("id", order.bin_id);
  }
  await supabase.from("bins").update(freeBin).eq("order_id", orderId);
  await supabase.from("bins").update(freeBin).eq("assigned_order_id", orderId);

  // Notify the student their food has moved to the late pickup counter
  if (order.user_id) {
    await insertNotification(supabase, {
      title: "⚠️ Food moved to late pickup counter",
      body: `Your order was not collected during your slot. Your food is now at the late pickup counter — please collect it as soon as possible.`,
      type: "late_pickup",
      recipient_type: "user",
      recipient_id: order.user_id,
      target_role: "user",
      created_by: auth.uid,
    }, "orders/clear-bin");
  }

  return NextResponse.json({ success: true, orderId, binLabel, binColor });
}
