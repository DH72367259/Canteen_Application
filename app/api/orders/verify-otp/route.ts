import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";
import { findUnfulfilledSiblings } from "@/lib/pickupGuard";

export const dynamic = "force-dynamic";

// POST /api/orders/verify-otp (worker backup path)
// Staff searches for an order by OTP alone (no order ID), verifies it, and marks collected.
// Used by the worker backup OTP entry screen when a customer shares their OTP verbally.
export async function POST(request: NextRequest) {
  const auth = await getRequestContext(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Workers and managers can use this endpoint
  if (!["canteen_admin", "vendor", "co_admin", "super_admin", "worker"].includes(auth.role)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { otp?: string; canteen_id?: string } | null;
  const otp = body?.otp?.toString().trim();
  if (!otp || otp.length < 4) {
    return NextResponse.json({ error: "OTP is required" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Use auth.canteenId if available (worker/canteen_admin bound to a canteen)
  // Otherwise use provided canteen_id (for super_admin/co_admin)
  const canteenId = auth.canteenId || body?.canteen_id;
  if (!canteenId) {
    return NextResponse.json({ error: "Canteen context required" }, { status: 400 });
  }

  // Find the order by OTP in this canteen, not yet collected/cancelled
  const { data: order } = await supabase
    .from("orders")
    .select("id, otp, status, canteen_id, bin_id, user_id")
    .eq("canteen_id", canteenId)
    .eq("otp", otp)
    .not("status", "in", `(collected,cancelled)`)
    .single<{ id: string; otp: string | null; status: string; canteen_id: string; bin_id: string | null; user_id: string | null }>();

  if (!order) {
    return NextResponse.json(
      { error: "Order not found or already collected" },
      { status: 404 },
    );
  }

  // Verify OTP matches
  if (order.otp !== otp) {
    return NextResponse.json({ error: "Invalid OTP" }, { status: 400 });
  }

  // Per-customer pickup guard
  const block = await findUnfulfilledSiblings(supabase, order);
  if (block) {
    return NextResponse.json(
      { error: block.message, siblings: block.siblings },
      { status: block.status },
    );
  }

  // Mark order as collected
  const { error: updateErr } = await supabase
    .from("orders")
    .update({
      status: "collected",
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id);

  if (updateErr) {
    return NextResponse.json(
      { error: "Failed to mark order collected" },
      { status: 500 },
    );
  }

  // Free all bins linked to this order (legacy single-bin and Phase-7 multi-bin)
  // 1. Orders with bin_id = this order's bin_id
  const { error: err1 } = await supabase
    .from("bins")
    .update({
      is_occupied: false,
      status: "empty",
      order_id: null,
    })
    .eq("order_id", order.id);

  // 2. Orders with assigned_order_id = this order's id (Phase-7 multi-bin)
  const { error: err2 } = await supabase
    .from("bins")
    .update({
      is_occupied: false,
      status: "empty",
      assigned_order_id: null,
    })
    .eq("assigned_order_id", order.id);

  if (err1 || err2) {
    console.warn("Warning: Failed to free some bins after OTP verification", {
      err1,
      err2,
    });
  }

  return NextResponse.json({
    success: true,
    message: "Order marked as collected",
    orderId: order.id,
  });
}
