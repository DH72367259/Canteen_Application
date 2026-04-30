import { NextRequest } from "next/server";
import { checkRateLimit, clientKey } from "@/lib/rateLimit";

const KEY_ID     = process.env.RAZORPAY_KEY_ID     || "";
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
// TEST MODE — when on, skips real Razorpay and returns a synthetic order id.
// Defaults ON so end-to-end testing works without a live Razorpay account or
// network access to checkout.razorpay.com. Flip PAYMENT_TEST_MODE="false" on
// Railway to enable real payments.
const TEST_MODE = process.env.PAYMENT_TEST_MODE !== "false";

export async function POST(req: NextRequest) {
  // Rate limit before doing any expensive work — IP-based since this endpoint
  // is called pre-auth (Razorpay order creation happens before payment).
  // 20 attempts/min is plenty for retry storms but blocks scraping.
  const rl = checkRateLimit(`rzp-order:${clientKey(req)}`, { limit: 20, windowMs: 60_000 });
  if (!rl.allowed) {
    return Response.json({ error: rl.message }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
  }

  const body        = await req.json();
  const amountPaise = Math.round((body.amount ?? 0) * 100);
  if (amountPaise < 100) {
    return Response.json({ error: "Minimum payable amount is \u20b91." }, { status: 400 });
  }

  // ── DUMMY MODE ───────────────────────────────────────────────────────────
  // Returns a synthetic order id and tells the client to skip the Razorpay
  // popup. The verify endpoint accepts these `test_` ids without HMAC.
  if (TEST_MODE || !KEY_ID || !KEY_SECRET) {
    const fakeOrderId = `order_test_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    return Response.json({
      orderId: fakeOrderId,
      amount:  amountPaise,
      currency: "INR",
      keyId:    KEY_ID || "rzp_test_dummy",
      testMode: true,
    });
  }
  const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
  const resp = await fetch("https://api.razorpay.com/v1/orders", {
    method:  "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body:    JSON.stringify({
      amount:   amountPaise,
      currency: "INR",
      receipt:  `rcpt_${Date.now()}`,
      notes:    { canteenId: body.canteenId || "", userId: body.userId || "" },
    }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    return Response.json({ error: data.error?.description ?? "Order creation failed." }, { status: 502 });
  }
  return Response.json({ orderId: data.id, amount: data.amount, currency: data.currency, keyId: KEY_ID });
}
