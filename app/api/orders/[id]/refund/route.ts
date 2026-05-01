/**
 * POST /api/orders/[id]/refund
 *
 * Admin-initiated manual refund retry for an already-cancelled order.
 * Razorpay holds the captured payment in the merchant balance, so a
 * refund debits from the admin (Razorpay) account back to the student.
 *
 * Use cases:
 *   - The auto-refund triggered by /api/orders/[id]/cancel failed
 *     (refund_status='failed') and operations want to retry.
 *   - The order was cancelled before the migration ran so refund_status
 *     is null/pending.
 *
 * Roles allowed: super_admin only — manual financial action requires
 * the highest privilege tier. Co-admins, canteen managers, and workers
 * cannot issue refunds even though they can cancel orders.
 */
import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const PAYMENT_ID_RE = /^pay_[A-Za-z0-9]{14,}$/;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await getRequestContext(request).catch(() => null);
  if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const role = auth.role ?? "";
  if (role !== "super_admin") {
    return NextResponse.json({ error: "Only the super admin can issue manual refunds." }, { status: 403 });
  }

  const { id: orderId } = await context.params;
  const supabase = createAdminClient();

  const { data: order, error: loadErr } = await supabase
    .from("orders")
    .select("id, status, payment_id, total_amount, user_id, refund_status, refund_id")
    .eq("id", orderId)
    .single<{
      id: string;
      status: string;
      payment_id: string | null;
      total_amount: number;
      user_id: string | null;
      refund_status: string | null;
      refund_id: string | null;
    }>();

  if (loadErr || !order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  if (order.status !== "cancelled") {
    return NextResponse.json({ error: "Refunds can only be issued for cancelled orders." }, { status: 400 });
  }

  if (order.refund_status === "processed" && order.refund_id) {
    return NextResponse.json({
      error: "This order has already been refunded.",
      refund: { status: "processed", id: order.refund_id },
    }, { status: 400 });
  }

  const paymentId = (order.payment_id ?? "").trim();
  if (!PAYMENT_ID_RE.test(paymentId)) {
    return NextResponse.json({ error: "This order has no Razorpay payment to refund." }, { status: 400 });
  }

  const KEY_ID     = process.env.RAZORPAY_KEY_ID     || "";
  const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
  if (!KEY_ID || !KEY_SECRET) {
    return NextResponse.json({ error: "Razorpay credentials are not configured on the server." }, { status: 500 });
  }

  const rzpAuth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
  const refundBody = {
    speed: "optimum",
    notes: {
      reason: "manual_admin_refund",
      order_id: orderId,
      retried_by_role: role,
    },
  };

  let refund_status: "processed" | "failed" = "failed";
  let refund_id: string | null = null;
  let refund_error: string | null = null;

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
      refund_error  = data?.error?.description || `Razorpay returned status ${resp.status}.`;
    }
  } catch (e) {
    refund_error = e instanceof Error ? e.message : "Refund request failed.";
  }

  // Persist outcome (best-effort — schema-drift fallback)
  const updates: Record<string, unknown> = {
    refund_status,
    refund_id,
    updated_at: new Date().toISOString(),
  };
  let { error: updErr } = await supabase
    .from("orders")
    .update(updates)
    .eq("id", orderId);
  if (updErr && /column .* does not exist/i.test(updErr.message)) {
    // Stale dev DB without the new columns — silently skip persistence.
    updErr = null;
  }
  if (updErr) {
    console.error("[orders/refund] persist failed", { orderId, err: updErr.message });
  }

  // Notify the student
  if (order.user_id && refund_status === "processed") {
    await supabase.from("notifications").insert({
      title: "Refund processed",
      body:  `Your refund of ₹${Number(order.total_amount ?? 0).toFixed(2)} has been processed and will reflect in 5–7 business days.`,
      type:  "order",
      recipient_type: "user",
      recipient_id:   order.user_id,
      target_role:    "user",
      created_by:     auth.uid,
    }).then(() => {}, () => {});
  }

  if (refund_status === "failed") {
    return NextResponse.json({
      error: refund_error || "Refund failed.",
      refund: { status: "failed", id: null, error: refund_error },
    }, { status: 502 });
  }

  return NextResponse.json({
    refund: { status: refund_status, id: refund_id, error: null },
  });
}
