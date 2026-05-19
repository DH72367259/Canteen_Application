/**
 * Auto-cancel an order at slot-start time when an item is out of stock,
 * trigger the Razorpay refund, mark the payment row, and notify the student.
 *
 * Called from autoAcceptPlacedOrders when the FIFO inventory walk decides
 * a placed order can't be fulfilled (most commonly because admin reduced
 * a cap after orders were placed). Keeps the auto-accept helper readable.
 *
 * Mirrors the refund + notify behavior of /api/orders/[id]/cancel but
 * runs server-internally — no HTTP round-trip to ourselves.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { insertNotification } from "@/lib/notify";

const RZP_PAYMENT_RE = /^pay_[A-Za-z0-9]{14,}$/;

interface AutoCancelOrder {
  id: string;
  user_id: string | null;
  payment_id: string | null;
  total_amount: number | string | null;
  slot_label: string | null;
}

export async function autoCancelOutOfStock(
  supabase: SupabaseClient,
  order: AutoCancelOrder,
  missingItemName: string,
): Promise<{ status: "cancelled"; refund_status: "processed" | "failed" | "not_required" | "pending" }> {
  const reason = `Auto-cancelled at slot start: ${missingItemName} is out of stock.`;

  // ── Razorpay refund (best-effort) ────────────────────────────────────────
  let refundStatus: "processed" | "failed" | "not_required" | "pending" = "not_required";
  let refundId: string | null = null;
  const paymentId = (order.payment_id ?? "").trim();

  if (RZP_PAYMENT_RE.test(paymentId)) {
    const KEY_ID = process.env.RAZORPAY_KEY_ID || "";
    const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
    if (!KEY_ID || !KEY_SECRET) {
      refundStatus = "pending";
    } else {
      // Resolve refund amount from payments table, falling back to order.total_amount
      const { data: payRow } = await supabase
        .from("payments")
        .select("amount_paise, refunded_amount_paise")
        .eq("razorpay_payment_id", paymentId)
        .maybeSingle<{ amount_paise: number | null; refunded_amount_paise: number | null }>();
      const grossPaise = Math.max(
        0,
        Number(payRow?.amount_paise ?? Math.round(Number(order.total_amount ?? 0) * 100)) || 0,
      );
      const alreadyRefundedPaise = Math.max(0, Number(payRow?.refunded_amount_paise ?? 0) || 0);
      const refundAmountPaise = Math.max(0, grossPaise - alreadyRefundedPaise);

      if (refundAmountPaise === 0) {
        refundStatus = "not_required";
      } else {
        try {
          const rzpAuth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
          const resp = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/refund`, {
            method: "POST",
            headers: { Authorization: `Basic ${rzpAuth}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              speed: "optimum",
              amount: refundAmountPaise,
              notes: { reason: "auto_cancel_out_of_stock", order_id: order.id, cancelled_by_role: "system" },
            }),
          });
          const data = (await resp.json().catch(() => ({}))) as { id?: string; error?: { description?: string } };
          if (resp.ok && data?.id) {
            refundStatus = "processed";
            refundId = data.id;
            const newRefunded = Math.min(grossPaise, alreadyRefundedPaise + refundAmountPaise);
            await supabase
              .from("payments")
              .update({
                status: newRefunded >= grossPaise ? "refunded" : "partial_refund",
                refunded_amount_paise: newRefunded,
                updated_at: new Date().toISOString(),
              })
              .eq("razorpay_payment_id", paymentId)
              .then(() => {}, () => {});
          } else {
            refundStatus = "failed";
          }
        } catch {
          refundStatus = "failed";
        }
      }
    }
  }

  // ── Persist the cancellation ─────────────────────────────────────────────
  const cancelledAt = new Date().toISOString();
  const updates: Record<string, unknown> = {
    status: "cancelled",
    cancellation_reason: reason,
    cancelled_by_role: "system",
    cancelled_at: cancelledAt,
    refund_status: refundStatus,
    refund_id: refundId,
    updated_at: cancelledAt,
  };

  // Tolerate staging schemas where the cancellation columns may not all exist.
  const tryUpdate = await supabase.from("orders").update(updates).eq("id", order.id);
  if (tryUpdate.error && /column .* does not exist/i.test(tryUpdate.error.message)) {
    await supabase
      .from("orders")
      .update({ status: "cancelled", updated_at: cancelledAt })
      .eq("id", order.id)
      .then(() => {}, () => {});
  }

  // ── Notify the student via the bell-icon feed ────────────────────────────
  if (order.user_id) {
    const refundBlurb =
      refundStatus === "processed"
        ? "Full refund processed."
        : refundStatus === "pending"
        ? "Refund will be processed manually within 24 hours."
        : refundStatus === "failed"
        ? "Refund failed — our team will retry within 24 hours."
        : "No payment refund needed.";
    await insertNotification(
      supabase,
      {
        title: "❌ Order cancelled",
        body: `${missingItemName} sold out before your slot${order.slot_label ? ` (${order.slot_label})` : ""}. ${refundBlurb}`,
        type: "cancelled",
        recipient_type: "user",
        recipient_id: order.user_id,
        target_role: "user",
        created_by: order.user_id, // self-targeted (system action, no human actor)
      },
      "auto-cancel-out-of-stock",
    );
  }

  return { status: "cancelled", refund_status: refundStatus };
}
