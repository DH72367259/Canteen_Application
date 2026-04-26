import { NextRequest } from "next/server";
import crypto from "crypto";

const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || "";
const KEY_ID         = process.env.RAZORPAY_KEY_ID         || "";
const KEY_SECRET     = process.env.RAZORPAY_KEY_SECRET     || "";

// Razorpay payment IDs always start with "pay_" — validate before using in API calls
const PAYMENT_ID_RE = /^pay_[A-Za-z0-9]{14,}$/;

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

  let event: { event: string; payload?: { payment?: { entity?: { id?: string } } } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const entity = event?.payload?.payment?.entity;

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
