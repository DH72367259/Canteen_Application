import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";
import { buildQrPayload, currentWindow } from "@/lib/qrToken";

export const dynamic = "force-dynamic";

// GET /api/orders/[id]/qr-token
// Returns the current 30-second QR payload for the order (student only).
// The payload rotates every 30s — never cached.
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await getRequestContext(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { id: orderId } = await context.params;
  const supabase = createAdminClient();

  const { data: order } = await supabase
    .from("orders")
    .select("id, user_id, status, canteen_id")
    .eq("id", orderId)
    .single<{ id: string; user_id: string | null; status: string; canteen_id: string | null }>();

  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });

  // Students can only fetch their own order's QR
  if (auth.role === "user" && order.user_id !== auth.uid) {
    return NextResponse.json({ error: "Access denied." }, { status: 403 });
  }

  // Staff can fetch any order in their canteen
  if (
    !["user"].includes(auth.role ?? "") &&
    auth.canteenId &&
    order.canteen_id &&
    auth.canteenId !== order.canteen_id
  ) {
    return NextResponse.json({ error: "Access denied." }, { status: 403 });
  }

  // late_pickup_pending = 5-min after-bin timer expired, worker still
  // physically shifting food. Student must keep showing the rotating QR
  // through this state, otherwise the code freezes the moment status flips.
  if (!["placed_in_bin", "ready_for_pickup", "late_pickup_pending", "late_pickup"].includes(order.status)) {
    return NextResponse.json({ error: "QR not available yet." }, { status: 400 });
  }

  const win = currentWindow();
  const payload = buildQrPayload(orderId);
  // Tell client when this window expires so it knows when to refresh
  const expiresAt = (win + 1) * 30_000;

  const response = NextResponse.json({ payload, expiresAt, orderId });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
