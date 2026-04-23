import { NextRequest } from "next/server";
import crypto from "crypto";

const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";

export async function POST(req: NextRequest) {
  if (!KEY_SECRET) {
    return Response.json({ error: "Razorpay is not configured on this server." }, { status: 503 });
  }
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = await req.json();
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return Response.json({ success: false, error: "Missing required payment fields." }, { status: 400 });
  }
  const expected = crypto
    .createHmac("sha256", KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");
  const valid = expected === razorpay_signature;
  return Response.json({ success: valid });
}
