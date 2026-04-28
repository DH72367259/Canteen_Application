import { NextRequest } from "next/server";
import { checkRateLimit, clientKey } from "@/lib/rateLimit";

const KEY_ID     = process.env.RAZORPAY_KEY_ID     || "";
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";

export async function POST(req: NextRequest) {
  // Rate limit before doing any expensive work — IP-based since this endpoint
  // is called pre-auth (Razorpay order creation happens before payment).
  // 20 attempts/min is plenty for retry storms but blocks scraping.
  const rl = checkRateLimit(`rzp-order:${clientKey(req)}`, { limit: 20, windowMs: 60_000 });
  if (!rl.allowed) {
    return Response.json({ error: rl.message }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
  }

  if (!KEY_ID || !KEY_SECRET) {
    return Response.json({ error: "Razorpay is not configured on this server." }, { status: 503 });
  }
  const body        = await req.json();
  const amountPaise = Math.round((body.amount ?? 0) * 100);
  if (amountPaise < 100) {
    return Response.json({ error: "Minimum payable amount is \u20b91." }, { status: 400 });
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
