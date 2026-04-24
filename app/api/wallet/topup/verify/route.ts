import { NextRequest } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export async function POST(req: NextRequest) {
  // Auth check
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace("Bearer ", "").trim();
  if (!token) return Response.json({ error: "Unauthorised" }, { status: 401 });

  if (!KEY_SECRET) {
    return Response.json({ error: "Razorpay is not configured." }, { status: 503 });
  }

  const body = await req.json();
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount, payment_method } = body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !amount) {
    return Response.json({ error: "Missing required fields." }, { status: 400 });
  }

  // Verify HMAC-SHA256 signature — prevents any tampering
  const expected = crypto
    .createHmac("sha256", KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  if (expected !== razorpay_signature) {
    return Response.json({ error: "Payment signature verification failed. Transaction rejected." }, { status: 400 });
  }

  // Verify user from Supabase JWT
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return Response.json({ error: "Unauthorised" }, { status: 401 });

  const amountRs = Math.round(Number(amount) / 100); // convert paise to rupees

  // Idempotency: check if this payment_id was already credited
  const { data: existing } = await supabase
    .from("wallet_transactions")
    .select("id")
    .eq("payment_id", razorpay_payment_id)
    .single();

  if (existing) {
    return Response.json({ error: "This payment has already been credited." }, { status: 409 });
  }

  // Determine which payment method was used (for withdrawal gateway-lock)
  // Razorpay returns method in payment details — we accept it from client and sanitise
  const allowedMethods = ["upi", "card", "netbanking", "wallet", "emi", "unknown"];
  const sanitisedMethod = allowedMethods.includes(payment_method?.toLowerCase?.() ?? "")
    ? (payment_method as string).toLowerCase()
    : "unknown";

  // Record top-up transaction
  const { error: txErr } = await supabase.from("wallet_transactions").insert({
    user_id: user.id,
    type: "topup",
    amount: amountRs,
    payment_id: razorpay_payment_id,
    razorpay_order_id,
    payment_method: sanitisedMethod,
    status: "completed",
    description: `Wallet top-up via ${sanitisedMethod.toUpperCase()}`,
  });
  if (txErr) {
    return Response.json({ error: "Failed to record transaction." }, { status: 500 });
  }

  // Credit wallet balance atomically
  const { error: walletErr } = await supabase.rpc("increment_wallet_balance", {
    p_user_id: user.id,
    p_delta: amountRs,
  });
  if (walletErr) {
    return Response.json({ error: "Failed to credit wallet." }, { status: 500 });
  }

  // Fetch updated balance
  const { data: profile } = await supabase
    .from("profiles")
    .select("wallet_balance")
    .eq("id", user.id)
    .single();

  return Response.json({
    success: true,
    credited: amountRs,
    newBalance: profile?.wallet_balance ?? 0,
  });
}
