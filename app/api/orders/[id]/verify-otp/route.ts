import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { canManageOrders } from "@/lib/roleChecks";
import { createAdminClient } from "@/lib/supabase-server";
import { findUnfulfilledSiblings } from "@/lib/pickupGuard";

export const dynamic = "force-dynamic";

// POST /api/orders/[id]/verify-otp
// Staff (canteen_admin / worker) verifies the customer OTP and transitions
// the order to `collected`, freeing every bin tied to it (legacy single-bin
// `order_id` and Phase-7 multi-bin `assigned_order_id`). This is the worker
// fallback so the worker can complete pickup when the manager isn't around.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await getRequestContext(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!canManageOrders(auth.role)) {
    return NextResponse.json({ error: "Access denied." }, { status: 403 });
  }
  if (!["canteen_admin", "vendor", "co_admin", "super_admin", "worker"].includes(auth.role)) {
    return NextResponse.json({ error: "OTP verification is staff-only." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { otp?: string } | null;
  const otp = body?.otp?.toString().trim();
  if (!otp || otp.length < 4) {
    return NextResponse.json({ error: "OTP is required." }, { status: 400 });
  }

  const { id: orderId } = await context.params;
  const supabase = createAdminClient();

  const { data: order } = await supabase
    .from("orders")
    .select("id, otp, status, canteen_id, bin_id, user_id")
    .eq("id", orderId)
    .single<{ id: string; otp: string | null; status: string; canteen_id: string | null; bin_id: string | null; user_id: string | null }>();

  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  if (auth.canteenId && order.canteen_id && auth.canteenId !== order.canteen_id) {
    return NextResponse.json({ error: "Access denied." }, { status: 403 });
  }
  if (["collected", "cancelled"].includes(order.status)) {
    return NextResponse.json({ error: `Order already ${order.status}.` }, { status: 400 });
  }
  if (!order.otp || order.otp !== otp) {
    return NextResponse.json({ error: "Invalid OTP." }, { status: 400 });
  }

  // Per-customer pickup guard: block if the same student has any other
  // order at this canteen that hasn't physically reached its bin yet.
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
    order_id: null,
    status: "empty",
    updated_at: nowIso,
  };

  await supabase
    .from("orders")
    .update({ status: "collected", updated_at: nowIso })
    .eq("id", orderId);
  await supabase.from("bins").update(freeBin).eq("order_id", orderId);
  await supabase.from("bins").update(freeBin).eq("assigned_order_id", orderId);

  return NextResponse.json({ success: true, orderId, binId: order.bin_id });
}
