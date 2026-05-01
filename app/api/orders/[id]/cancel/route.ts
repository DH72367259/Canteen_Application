/**
 * POST /api/orders/[id]/cancel
 *
 * Staff-initiated order cancellation with mandatory reason and
 * automatic Razorpay refund.
 *
 * Roles allowed: super_admin | co_admin | canteen_admin | vendor | worker
 * (canteen staff are restricted to their own canteen).
 *
 * Side-effects:
 *   1. Validates order is still cancellable (not collected / not already cancelled).
 *   2. Marks the order: status='cancelled', cancellation_reason, cancelled_by,
 *      cancelled_by_role, cancelled_at, refund_status, refund_id.
 *   3. Frees any reserved bins (single-bin and multi-bin).
 *   4. If payment_id looks like a real Razorpay pay_… id, fires a refund via
 *      /api/payments/razorpay-refund (server-to-server). Refund failures are
 *      surfaced in `refund_status='failed'` but the cancel still succeeds —
 *      operations can manually refund from the Razorpay dashboard.
 *   5. Inserts a notification visible to the student so they see the reason
 *      on their order tracking page.
 */
import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { canManageOrders } from "@/lib/roleChecks";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const PAYMENT_ID_RE = /^pay_[A-Za-z0-9]{14,}$/;
const MAX_REASON_LEN = 280;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  // ─── Auth ─────────────────────────────────────────────────────────────
  let auth;
  try {
    auth = await getRequestContext(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  // Worker, canteen_admin, vendor, super_admin and co_admin can cancel orders.
  // Anyone else (regular users) is rejected.
  const role = auth.role ?? "";
  const isPlatformAdmin = role === "super_admin" || role === "co_admin";
  const isCanteenStaff  = role === "canteen_admin" || role === "vendor" || role === "worker";
  if (!isPlatformAdmin && !isCanteenStaff) {
    return NextResponse.json({ error: "Only canteen staff and platform admins can cancel orders." }, { status: 403 });
  }
  if (!canManageOrders(role)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  // ─── Body ─────────────────────────────────────────────────────────────
  const body = (await request.json().catch(() => null)) as { reason?: string } | null;
  const reasonRaw = (body?.reason ?? "").trim();
  if (!reasonRaw) {
    return NextResponse.json({ error: "A cancellation reason is required." }, { status: 400 });
  }
  if (reasonRaw.length > MAX_REASON_LEN) {
    return NextResponse.json({ error: `Reason must be under ${MAX_REASON_LEN} characters.` }, { status: 400 });
  }

  const { id: orderId } = await context.params;
  const supabase = createAdminClient();

  // ─── Load + validate order ────────────────────────────────────────────
  const { data: order, error: loadErr } = await supabase
    .from("orders")
    .select("id, status, canteen_id, bin_id, user_id, total_amount, payment_id, cancelled_at")
    .eq("id", orderId)
    .single<{
      id: string;
      status: string;
      canteen_id: string;
      bin_id: string | null;
      user_id: string | null;
      total_amount: number;
      payment_id: string | null;
      cancelled_at: string | null;
    }>();

  if (loadErr || !order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  // Canteen staff (worker / vendor / canteen_admin) can only cancel orders for their own canteen.
  if (isCanteenStaff && auth.canteenId && order.canteen_id !== auth.canteenId) {
    return NextResponse.json({ error: "You can only cancel orders for your own canteen." }, { status: 403 });
  }

  if (order.status === "cancelled") {
    return NextResponse.json({ error: "Order is already cancelled." }, { status: 400 });
  }
  if (order.status === "collected" || order.status === "completed") {
    return NextResponse.json({ error: "Cannot cancel an order that has already been collected." }, { status: 400 });
  }

  // ─── Attempt refund (best-effort, non-blocking for the cancel itself) ──
  let refund_status: "processed" | "failed" | "not_required" | "pending" = "not_required";
  let refund_id: string | null = null;
  let refund_error: string | null = null;

  const paymentId = (order.payment_id ?? "").trim();
  if (PAYMENT_ID_RE.test(paymentId)) {
    const KEY_ID     = process.env.RAZORPAY_KEY_ID     || "";
    const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
    if (!KEY_ID || !KEY_SECRET) {
      refund_status = "pending";
      refund_error  = "Razorpay credentials not configured on this server — refund must be processed manually.";
    } else {
      const rzpAuth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
      const refundBody = {
        speed: "optimum",
        notes: {
          reason: "order_cancelled",
          order_id: orderId,
          cancelled_by_role: role,
        },
      };
      try {
        const resp = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/refund`, {
          method:  "POST",
          headers: { Authorization: `Basic ${rzpAuth}`, "Content-Type": "application/json" },
          body:    JSON.stringify(refundBody),
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok && data?.id) {
          refund_status = "processed";
          refund_id     = data.id;
        } else {
          refund_status = "failed";
          refund_error  = data?.error?.description || `Razorpay returned status ${resp.status}.`;
        }
      } catch (e) {
        refund_status = "failed";
        refund_error  = e instanceof Error ? e.message : "Refund request failed.";
      }
    }
  }

  // ─── Persist the cancellation ─────────────────────────────────────────
  const cancelledAt = new Date().toISOString();
  const updates: Record<string, unknown> = {
    status:              "cancelled",
    cancellation_reason: reasonRaw,
    cancelled_by:        auth.uid,
    cancelled_by_role:   role,
    cancelled_at:        cancelledAt,
    refund_status,
    refund_id,
    updated_at:          cancelledAt,
  };

  let { data: updated, error: updErr } = await supabase
    .from("orders")
    .update(updates)
    .eq("id", orderId)
    .select("id, status, cancellation_reason, cancelled_at, refund_status, refund_id")
    .single();

  // Schema-drift fallback: if the new cancellation columns aren't present in
  // a stale dev DB, retry with just status + updated_at so the cancel still
  // works. Production should always have run the migration first.
  if (updErr && /column .* does not exist/i.test(updErr.message)) {
    const slim = { status: "cancelled", updated_at: cancelledAt };
    const retry = await supabase
      .from("orders")
      .update(slim)
      .eq("id", orderId)
      .select("id, status")
      .single();
    updated = retry.data as typeof updated;
    updErr  = retry.error;
  }

  if (updErr || !updated) {
    console.error("[orders/cancel] update failed", { orderId, err: updErr?.message });
    return NextResponse.json({ error: "Failed to cancel order." }, { status: 500 });
  }

  // ─── Free any reserved bins ───────────────────────────────────────────
  const freeUpdate = {
    is_occupied: false,
    assigned_order_id: null,
    order_id: null,
    status: "empty",
    updated_at: cancelledAt,
  };
  if (order.bin_id) {
    await supabase.from("bins").update(freeUpdate).eq("id", order.bin_id).then(() => {}, () => {});
  }
  await supabase.from("bins").update(freeUpdate).eq("assigned_order_id", orderId).then(() => {}, () => {});
  await supabase.from("bins").update(freeUpdate).eq("order_id", orderId).then(() => {}, () => {});

  // ─── Notify the student ───────────────────────────────────────────────
  if (order.user_id) {
    const refundLine =
      refund_status === "processed" ? "Your refund has been initiated and will reflect in 5–7 business days."
      : refund_status === "failed"   ? "Refund attempt failed — our team will process it manually within 24 hours."
      : refund_status === "pending"  ? "Refund will be processed manually within 24 hours."
      : "No payment was charged for this order.";
    await supabase.from("notifications").insert({
      title: "Order cancelled by canteen",
      body:  `Reason: ${reasonRaw}. ${refundLine}`,
      type:  "order",
      recipient_type: "user",
      recipient_id:   order.user_id,
      target_role:    "user",
      created_by:     auth.uid,
    }).then(() => {}, () => {});
  }

  // ─── Notify the canteen + admin ───────────────────────────────────────
  await supabase.from("notifications").insert({
    title: "Order cancelled",
    body:  `Order ${orderId.slice(0, 8).toUpperCase()} cancelled by ${role}. Reason: ${reasonRaw}`,
    type:  "order",
    recipient_type: "canteen",
    recipient_id:   order.canteen_id,
    target_role:    "canteen_admin",
    created_by:     auth.uid,
  }).then(() => {}, () => {});

  return NextResponse.json({
    order: updated,
    refund: {
      status: refund_status,
      id: refund_id,
      error: refund_error,
    },
  });
}
