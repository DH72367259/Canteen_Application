import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";
import { verifyQrPayload } from "@/lib/qrToken";
import { findUnfulfilledSiblings } from "@/lib/pickupGuard";

export const dynamic = "force-dynamic";

// POST /api/orders/[id]/verify-qr
// Worker scans the student's rotating QR code and verifies it.
// The QR payload contains a time-windowed HMAC token (rotates every 30s).
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await getRequestContext(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!["canteen_admin", "vendor", "co_admin", "super_admin", "worker"].includes(auth.role ?? "")) {
    return NextResponse.json({ error: "Staff-only." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { qrPayload?: string } | null;
  const qrPayload = body?.qrPayload?.trim();
  if (!qrPayload) {
    return NextResponse.json({ error: "QR payload required." }, { status: 400 });
  }

  const { id: orderId } = await context.params;

  // Verify the TOTP-style payload matches this order
  const verifiedOrderId = verifyQrPayload(qrPayload);
  if (!verifiedOrderId) {
    return NextResponse.json({ error: "QR code expired or invalid. Ask the student to refresh." }, { status: 400 });
  }
  if (verifiedOrderId !== orderId) {
    return NextResponse.json({ error: "QR code does not match this order." }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: order } = await supabase
    .from("orders")
    .select("id, status, canteen_id, bin_id, user_id, slot_id, slot_label")
    .eq("id", orderId)
    .single<{ id: string; status: string; canteen_id: string | null; bin_id: string | null; user_id: string | null; slot_id: string | null; slot_label: string | null }>();

  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  if (auth.canteenId && order.canteen_id && auth.canteenId !== order.canteen_id) {
    return NextResponse.json({ error: "Access denied." }, { status: 403 });
  }
  if (["collected", "cancelled"].includes(order.status)) {
    return NextResponse.json({ error: `Order already ${order.status}.` }, { status: 400 });
  }
  if (!["placed_in_bin", "ready_for_pickup", "late_pickup"].includes(order.status)) {
    return NextResponse.json({ error: "Order is not ready for pickup yet." }, { status: 400 });
  }

  const block = await findUnfulfilledSiblings(supabase, order);
  if (block) {
    return NextResponse.json(
      { error: block.message, siblings: block.siblings },
      { status: block.status },
    );
  }

  const nowIso = new Date().toISOString();
  const freeBin = {
    is_occupied: false,
    assigned_order_id: null,
    current_order_id: null,
    status: "empty",
    updated_at: nowIso,
  };

  await supabase
    .from("orders")
    .update({ status: "collected", updated_at: nowIso })
    .eq("id", orderId);
  await supabase.from("bins").update(freeBin).eq("current_order_id", orderId);
  await supabase.from("bins").update(freeBin).eq("assigned_order_id", orderId);

  return NextResponse.json({ success: true, orderId, binId: order.bin_id });
}
