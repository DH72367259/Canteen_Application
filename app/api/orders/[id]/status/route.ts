import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { canManageOrders } from "@/lib/roleChecks";
import { createAdminClient } from "@/lib/supabase-server";

// All valid raw Supabase status values + legacy keys
const STAFF_STATUSES = ["placed", "confirmed", "preparing", "ready_for_placement", "placed_in_bin", "ready_for_pickup", "collected", "cancelled", "received", "ready", "completed"];
const STUDENT_STATUSES = ["collected"];

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let auth;
  try {
    auth = await getRequestContext(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const payload = (await request.json().catch(() => null)) as { status?: string } | null;
  const status = payload?.status;

  if (!status) {
    return NextResponse.json({ error: "Status is required." }, { status: 400 });
  }

  const isStaff = canManageOrders(auth.role);

  if (isStaff && !STAFF_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }

  if (!isStaff && !STUDENT_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Not permitted." }, { status: 403 });
  }

  const { id: orderId } = await context.params;
  const supabase = createAdminClient();

  // For non-staff, verify they own the order
  if (!isStaff) {
    const { data: order } = await supabase.from("orders").select("user_id").eq("id", orderId).single();
    if (!order || order.user_id !== auth.uid) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
  }

  // For collected status, free up the bin
  if (status === "collected") {
    await supabase.from("bins").update({ is_occupied: false, order_id: null, updated_at: new Date().toISOString() }).eq("order_id", orderId);
  }

  const { data: updated, error } = await supabase
    .from("orders")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", orderId)
    .select("id, status")
    .single();

  if (error || !updated) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  return NextResponse.json({ order: updated });
}
