/**
 * Race-loss rollback with automatic Razorpay refund.
 *
 * Used by /api/orders/place when a post-creation capacity recheck reveals
 * that two concurrent orders both passed the pre-creation gate but the
 * total now exceeds the slot or per-item cap. The loser of the race needs
 * their order rolled back AND their payment refunded — otherwise the
 * student pays but doesn't get the item and we generate a support ticket
 * for every race.
 *
 * Behaviour:
 *   1. Marks the order status='cancelled' with race-loss audit metadata
 *      (cancellation_reason, refund_status, refund_id). NOT deleted — the
 *      row + order_items stay around for audit; capacity calc already
 *      excludes status='cancelled'.
 *   2. If the order has a Razorpay payment_id, fires an inline refund
 *      via the Razorpay REST API.
 *   3. Updates the payments table row to status='refunded' so the
 *      settlement ledger is consistent.
 *   4. Returns refund status so the caller can include it in the error
 *      response back to the client ("your ₹X is being refunded").
 *
 * Schema-drift safe: if cancellation_reason / refund_status / refund_id
 * columns don't exist (older staging schema), the audit columns are
 * silently dropped from the UPDATE and only `status='cancelled'` is set.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const PAYMENT_ID_RE = /^pay_[A-Za-z0-9]{14,}$/;

export type RefundStatus = "processed" | "failed" | "pending" | "not_required";

export interface RollbackResult {
  refund_status: RefundStatus;
  refund_id: string | null;
  refund_amount_rupees: number;
}

export async function rollbackOrderWithRefund(
  supabase: SupabaseClient,
  orderId: string,
  cancellationReason: string,
): Promise<RollbackResult> {
  // 1. Read what we need to fire the refund
  const { data: o } = await supabase
    .from("orders")
    .select("payment_id, total_amount")
    .eq("id", orderId)
    .single<{ payment_id: string | null; total_amount: number | null }>();

  let refund_status: RefundStatus = "not_required";
  let refund_id: string | null = null;
  const refund_amount_rupees = Number(o?.total_amount ?? 0);

  // 2. Fire Razorpay refund if applicable
  const paymentId = (o?.payment_id ?? "").trim();
  if (paymentId && PAYMENT_ID_RE.test(paymentId)) {
    const KEY_ID     = process.env.RAZORPAY_KEY_ID     || "";
    const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
    if (!KEY_ID || !KEY_SECRET) {
      // Keys not deployed (test environment) — mark pending for manual
      // refund. Don't block the rollback on missing env.
      refund_status = "pending";
    } else {
      try {
        const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
        const amountPaise = Math.round(refund_amount_rupees * 100);
        const body: Record<string, unknown> = {
          speed: "optimum",
          notes: {
            reason: cancellationReason,
            order_id: orderId,
            cancelled_by_role: "system",
          },
        };
        if (amountPaise > 0) body.amount = amountPaise;
        const resp = await fetch(
          `https://api.razorpay.com/v1/payments/${paymentId}/refund`,
          {
            method:  "POST",
            headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
            body:    JSON.stringify(body),
          },
        );
        const data = (await resp.json().catch(() => ({}))) as { id?: string; error?: { description?: string } };
        if (resp.ok && data.id) {
          refund_status = "processed";
          refund_id = data.id;
          // Mirror refund onto the payments ledger so settlement reports
          // stay consistent. Silent on failure — refund itself succeeded.
          await supabase
            .from("payments")
            .update({
              status: "refunded",
              refunded_amount_paise: amountPaise,
              updated_at: new Date().toISOString(),
            })
            .eq("razorpay_payment_id", paymentId)
            .then(() => {}, () => {});
        } else {
          refund_status = "failed";
          console.warn(
            `[order-race-rollback] refund failed for ${orderId}:`,
            data.error?.description ?? resp.status,
          );
        }
      } catch (e) {
        refund_status = "failed";
        console.warn(
          `[order-race-rollback] refund threw for ${orderId}:`,
          (e as Error).message,
        );
      }
    }
  }

  // 3. Mark order cancelled with audit metadata
  const cancelledAt = new Date().toISOString();
  const fullMeta: Record<string, unknown> = {
    status: "cancelled",
    cancellation_reason: cancellationReason,
    cancelled_by_role: "system",
    cancelled_at: cancelledAt,
    refund_status,
    refund_id,
    updated_at: cancelledAt,
  };
  const fullUpdate = await supabase.from("orders").update(fullMeta).eq("id", orderId);
  if (fullUpdate.error && /column .* does not exist/i.test(fullUpdate.error.message)) {
    // Older schema — drop audit columns, keep status='cancelled'
    await supabase
      .from("orders")
      .update({ status: "cancelled", updated_at: cancelledAt })
      .eq("id", orderId);
  }

  // 4. Free any bins that were assigned to this order. Cancelled orders
  // shouldn't hold a bin — another order in the slot might need it.
  const freeBin = {
    is_occupied: false,
    assigned_order_id: null,
    order_id: null,
    status: "empty",
    updated_at: cancelledAt,
  };
  await supabase.from("bins").update(freeBin).eq("order_id", orderId).then(() => {}, () => {});
  await supabase.from("bins").update(freeBin).eq("assigned_order_id", orderId).then(() => {}, () => {});

  return { refund_status, refund_id, refund_amount_rupees };
}
