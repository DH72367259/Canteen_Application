import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { canManageOrders } from "@/lib/roleChecks";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

// POST /api/bins/[id]/mark-picked
// Worker marks a bin as picked up (food collected by user), freeing it.
// Manager normally does this; if manager absent, worker can do it too.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await getRequestContext(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!canManageOrders(auth.role))
    return NextResponse.json({ error: "Access denied." }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { orderRef?: string } | null;
  const providedRef = body?.orderRef?.toString().trim().toUpperCase() ?? "";

  const { id: binId } = await context.params;
  const supabase = createAdminClient();

  // Fetch the bin and its associated order
  const { data: bin, error: binErr } = await supabase
    .from("bins")
    .select("id, order_id, assigned_order_id, canteen_id, is_occupied")
    .eq("id", binId)
    .single();

  if (binErr || !bin) return NextResponse.json({ error: "Bin not found." }, { status: 404 });

  // Security: worker can only access bins for their canteen
  if (auth.canteenId && bin.canteen_id !== auth.canteenId) {
    return NextResponse.json({ error: "Access denied." }, { status: 403 });
  }

  const activeOrderId = bin.assigned_order_id ?? bin.order_id;

  if (!bin.is_occupied || !activeOrderId) {
    return NextResponse.json({ error: "Bin is already empty." }, { status: 400 });
  }

  // Worker fallback (manager absent): confirm by spoken order number.
  if (auth.role === "worker") {
    if (providedRef.length < 4) {
      return NextResponse.json({ error: "Order reference is required for worker handover." }, { status: 400 });
    }
    const normalizedOrder = String(activeOrderId).toUpperCase();
    const suffix = normalizedOrder.slice(-6);
    if (providedRef !== suffix && providedRef !== normalizedOrder) {
      return NextResponse.json({ error: "Order reference does not match this bin." }, { status: 400 });
    }
  }

  // Mark order as collected and free the bin in a transaction-like sequence
  const [orderResult] = await Promise.all([
    supabase
      .from("orders")
      .update({ status: "collected", updated_at: new Date().toISOString() })
      .eq("id", activeOrderId)
      .select("id")
      .single(),
    supabase
      .from("bins")
      .update({ is_occupied: false, order_id: null, assigned_order_id: null, status: "empty", updated_at: new Date().toISOString() })
      .eq("id", binId),
  ]);

  if (orderResult.error) {
    return NextResponse.json({ error: "Failed to update order." }, { status: 500 });
  }

  return NextResponse.json({ success: true, orderId: activeOrderId });
}
