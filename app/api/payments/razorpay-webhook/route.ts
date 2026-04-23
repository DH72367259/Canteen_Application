import { NextRequest } from "next/server";
import crypto from "crypto";

const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || "";
const KEY_ID         = process.env.RAZORPAY_KEY_ID         || "";
const KEY_SECRET     = process.env.RAZORPAY_KEY_SECRET     || "";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const sig     = req.headers.get("x-razorpay-signature") ?? "";

  // Verify webhook signature if secret is configured
  if (WEBHOOK_SECRET) {
    const expected = crypto
      .createHmac("sha256", WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");
    if (expected !== sig) {
      return Response.json({ error: "Invalid signature." }, { status: 401 });
    }
  }

  const event  = JSON.parse(rawBody) as { event: string; payload?: { payment?: { entity?: { id?: string } } } };
  const entity = event?.payload?.payment?.entity;

  // Auto-refund on payment.failed
  if (event.event === "payment.failed" && entity?.id && KEY_ID && KEY_SECRET) {
    const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
    await fetch(`https://api.razorpay.com/v1/payments/${entity.id}/refund`, {
      method:  "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body:    JSON.stringify({ speed: "optimum", notes: { reason: "payment_failed_webhook" } }),
    });
  }

  return Response.json({ received: true });
}
