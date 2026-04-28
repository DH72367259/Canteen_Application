import { NextRequest } from "next/server";
import crypto from "crypto";
import { recordPaymentIdempotent } from "@/lib/paymentLedger";
import { createAdminClient } from "@/lib/supabase-server";

const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || "";
const KEY_ID         = process.env.RAZORPAY_KEY_ID         || "";
const KEY_SECRET     = process.env.RAZORPAY_KEY_SECRET     || "";

// Razorpay payment IDs always start with "pay_" — validate before using in API calls
const PAYMENT_ID_RE = /^pay_[A-Za-z0-9]{14,}$/;
const ORDER_ID_RE   = /^order_[A-Za-z0-9]{14,}$/;

export async function POST(req: NextRequest) {
  // ── Require webhook secret — never skip signature verification ──────────
  if (!WEBHOOK_SECRET) {
    // If secret is not configured, refuse all webhook calls rather than silently accepting them.
    // This prevents attackers from triggering auto-refunds in dev environents without a secret.
    return Response.json({ error: "Webhook not configured." }, { status: 503 });
  }

  const rawBody = await req.text();
  const sig     = req.headers.get("x-razorpay-signature") ?? "";

  const expected = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  // Use constant-time comparison to prevent timing attacks
  const sigBuf      = Buffer.from(sig,      "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (
    sigBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expectedBuf)
  ) {
    return Response.json({ error: "Invalid signature." }, { status: 401 });
  }

  interface RzpPaymentEntity {
    id?: string;
    order_id?: string;
    amount?: number;
    status?: string;
  }
  interface RzpRefundEntity {
    payment_id?: string;
    amount?: number;
  }
  let event: {
    event: string;
    payload?: {
      payment?: { entity?: RzpPaymentEntity };
      refund?:  { entity?: RzpRefundEntity };
    };
  };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const entity = event?.payload?.payment?.entity;

  // ── payment.captured: idempotently record the payment in the audit ledger ─
  // The synchronous handler in /api/orders/place may have already inserted
  // this row; recordPaymentIdempotent is a no-op in that case.
  if (
    event.event === "payment.captured" &&
    entity?.id && entity?.order_id &&
    PAYMENT_ID_RE.test(entity.id) && ORDER_ID_RE.test(entity.order_id) &&
    typeof entity.amount === "number" && entity.amount > 0
  ) {
    try {
      await recordPaymentIdempotent({
        razorpay_order_id:   entity.order_id,
        razorpay_payment_id: entity.id,
        amount_paise:        entity.amount,
        status:              "captured",
        raw_event:           event,
      });
    } catch (e) {
      console.error("[razorpay-webhook] ledger insert failed:", e);
    }
  }

  // ── refund.processed: mark the payment row refunded ──────────────────────
  if (event.event === "refund.processed") {
    const refund = event?.payload?.refund?.entity;
    if (refund?.payment_id && PAYMENT_ID_RE.test(refund.payment_id) && typeof refund.amount === "number") {
      try {
        const supabase = createAdminClient();
        const { data: existing } = await supabase
          .from("payments")
          .select("id, amount_paise, refunded_amount_paise")
          .eq("razorpay_payment_id", refund.payment_id)
          .maybeSingle();
        if (existing) {
          const newRefunded = (existing.refunded_amount_paise || 0) + refund.amount;
          const status = newRefunded >= existing.amount_paise ? "refunded" : "partial_refund";
          await supabase
            .from("payments")
            .update({
              refunded_amount_paise: newRefunded,
              status,
              raw_event: event,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existing.id);
        }
      } catch (e) {
        console.error("[razorpay-webhook] refund update failed:", e);
      }
    }
  }

  // Auto-refund on payment.failed — validate payment ID before using in API call
  if (event.event === "payment.failed" && entity?.id && KEY_ID && KEY_SECRET) {
    if (!PAYMENT_ID_RE.test(entity.id)) {
      // Malformed ID — log and ignore, don't forward to Razorpay
      return Response.json({ received: true });
    }
    const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
    await fetch(`https://api.razorpay.com/v1/payments/${entity.id}/refund`, {
      method:  "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body:    JSON.stringify({ speed: "optimum", notes: { reason: "payment_failed_webhook" } }),
    });
  }

  return Response.json({ received: true });
}
