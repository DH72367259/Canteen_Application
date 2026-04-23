import { NextRequest } from "next/server";

const KEY_ID     = process.env.RAZORPAY_KEY_ID     || "";
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";

export async function POST(req: NextRequest) {
  if (!KEY_ID || !KEY_SECRET) {
    return Response.json({ error: "Razorpay is not configured on this server." }, { status: 503 });
  }
  const { paymentId, amount, reason } = await req.json();
  if (!paymentId) {
    return Response.json({ error: "Missing paymentId." }, { status: 400 });
  }
  const auth                              = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
  const body: Record<string, unknown>     = { speed: "optimum", notes: { reason: reason ?? "payment_failed" } };
  if (amount)                               body.amount = Math.round(amount * 100);
  const resp = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/refund`, {
    method:  "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  const data = await resp.json();
  return Response.json({
    success:  resp.ok,
    refundId: data.id,
    status:   data.status,
    error:    data.error?.description,
  });
}
