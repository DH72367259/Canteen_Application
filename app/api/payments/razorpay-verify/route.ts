import { NextRequest } from "next/server";
import crypto from "crypto";

const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
const TEST_MODE  = process.env.PAYMENT_TEST_MODE !== "false";

export async function POST(req: NextRequest) {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = await req.json();
  if (!razorpay_order_id || !razorpay_payment_id) {
    return Response.json({ success: false, error: "Missing required payment fields." }, { status: 400 });
  }

  // ── DUMMY MODE — accept synthetic order/payment ids without HMAC ────────
  const looksSynthetic =
    String(razorpay_order_id).startsWith("order_test_") ||
    String(razorpay_payment_id).startsWith("pay_test_");
  if (TEST_MODE || looksSynthetic || !KEY_SECRET) {
    return Response.json({ success: true, testMode: true });
  }

  if (!razorpay_signature) {
    return Response.json({ success: false, error: "Missing required payment fields." }, { status: 400 });
  }
  const expected = crypto
    .createHmac("sha256", KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");
  const valid = expected === razorpay_signature;
  return Response.json({ success: valid });
}
