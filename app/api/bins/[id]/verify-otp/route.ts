import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { canManageOrders } from "@/lib/roleChecks";
import { createAdminClient } from "@/lib/supabase-server";
import { findUnfulfilledSiblings } from "@/lib/pickupGuard";

export const dynamic = "force-dynamic";

// POST /api/bins/[id]/verify-otp
// Staff or worker verifies the user's OTP to confirm pickup.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await getRequestContext(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!canManageOrders(auth.role))
    return NextResponse.json({ error: "Access denied." }, { status: 403 });
  if (!["canteen_admin", "vendor", "co_admin", "super_admin", "worker"].includes(auth.role)) {
    return NextResponse.json({ error: "OTP verification is staff-only." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const otp = body?.otp?.toString()?.trim();
  if (!otp || otp.length < 4) return NextResponse.json({ error: "OTP is required." }, { status: 400 });

  const { id: binId } = await context.params;
  const supabase = createAdminClient();

  const { data: bin } = await supabase
    .from("bins")
    .select("id, order_id, canteen_id")
    .eq("id", binId)
    .single();

  if (!bin?.order_id) return NextResponse.json({ error: "No active order for this bin." }, { status: 404 });
  if (auth.canteenId && bin.canteen_id !== auth.canteenId) {
    return NextResponse.json({ error: "Access denied." }, { status: 403 });
  }

  const { data: order } = await supabase
    .from("orders")
    .select("id, otp, status, user_id, canteen_id, slot_id, slot_label")
    .eq("id", bin.order_id)
    .single<{ id: string; otp: string | null; status: string; user_id: string | null; canteen_id: string | null; slot_id: string | null; slot_label: string | null }>();

  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  if (order.otp !== otp) return NextResponse.json({ error: "Invalid OTP." }, { status: 400 });

  // Per-customer pickup guard — see lib/pickupGuard.ts.
  const block = await findUnfulfilledSiblings(supabase, order);
  if (block) {
    return NextResponse.json(
      { error: block.message, siblings: block.siblings },
      { status: block.status },
    );
  }

  // Mark collected and free bin
  await Promise.all([
    supabase.from("orders").update({ status: "collected", updated_at: new Date().toISOString() }).eq("id", order.id),
    supabase.from("bins").update({ is_occupied: false, order_id: null, updated_at: new Date().toISOString() }).eq("id", binId),
  ]);

  return NextResponse.json({ success: true, orderId: order.id });
}
