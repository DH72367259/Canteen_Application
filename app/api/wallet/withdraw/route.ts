import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const KEY_ID = process.env.RAZORPAY_KEY_ID || "";
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const MIN_WALLET_RESERVE = 100; // ₹100 must always remain — cannot be withdrawn

export async function POST(req: NextRequest) {
  // Auth check
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace("Bearer ", "").trim();
  if (!token) return Response.json({ error: "Unauthorised" }, { status: 401 });

  if (!KEY_ID || !KEY_SECRET) {
    return Response.json({ error: "Razorpay is not configured." }, { status: 503 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return Response.json({ error: "Unauthorised" }, { status: 401 });

  const body = await req.json();
  const requestedAmount = Math.round(Number(body.amount ?? 0));

  if (requestedAmount <= 0) {
    return Response.json({ error: "Invalid withdrawal amount." }, { status: 400 });
  }

  // Fetch current balance and latest top-up payment method
  const { data: profile } = await supabase
    .from("profiles")
    .select("wallet_balance")
    .eq("id", user.id)
    .single();

  const balance = Number(profile?.wallet_balance ?? 0);
  const withdrawableBalance = balance - MIN_WALLET_RESERVE;

  if (withdrawableBalance <= 0) {
    return Response.json({
      error: `You cannot withdraw. A minimum balance of ₹${MIN_WALLET_RESERVE} must always remain in your wallet.`,
    }, { status: 400 });
  }

  if (requestedAmount > withdrawableBalance) {
    return Response.json({
      error: `You can withdraw at most ₹${withdrawableBalance}. ₹${MIN_WALLET_RESERVE} minimum must remain in your wallet.`,
    }, { status: 400 });
  }

  // Get the most recent topup transaction to determine gateway
  const { data: lastTopup } = await supabase
    .from("wallet_transactions")
    .select("payment_id, payment_method")
    .eq("user_id", user.id)
    .eq("type", "topup")
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!lastTopup?.payment_id) {
    return Response.json({ error: "No eligible top-up found to refund to." }, { status: 400 });
  }

  // Issue refund to the SAME gateway via Razorpay Refunds API
  const rzpAuth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
  const refundResp = await fetch(`https://api.razorpay.com/v1/payments/${lastTopup.payment_id}/refund`, {
    method: "POST",
    headers: { Authorization: `Basic ${rzpAuth}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: requestedAmount * 100, // to paise
      speed: "normal",
      notes: {
        reason: "wallet_withdrawal",
        userId: user.id,
        method: lastTopup.payment_method,
      },
    }),
  });

  const refundData = await refundResp.json();
  if (!refundResp.ok) {
    return Response.json({ error: refundData.error?.description ?? "Refund initiation failed." }, { status: 502 });
  }

  // Deduct from wallet atomically
  const { error: deductErr } = await supabase.rpc("increment_wallet_balance", {
    p_user_id: user.id,
    p_delta: -requestedAmount,
  });
  if (deductErr) {
    return Response.json({ error: "Wallet deduction failed. Contact support with refund ID: " + refundData.id }, { status: 500 });
  }

  // Record withdrawal transaction
  await supabase.from("wallet_transactions").insert({
    user_id: user.id,
    type: "withdrawal",
    amount: -requestedAmount,
    payment_id: refundData.id,
    razorpay_order_id: refundData.payment_id,
    payment_method: lastTopup.payment_method,
    status: "processing",
    description: `Withdrawal refunded to ${lastTopup.payment_method?.toUpperCase()} (5-7 working days)`,
  });

  const { data: updated } = await supabase
    .from("profiles")
    .select("wallet_balance")
    .eq("id", user.id)
    .single();

  return Response.json({
    success: true,
    refundId: refundData.id,
    refundedAmount: requestedAmount,
    refundMethod: lastTopup.payment_method,
    newBalance: updated?.wallet_balance ?? 0,
    message: `₹${requestedAmount} will be refunded to your ${lastTopup.payment_method?.toUpperCase()} within 5–7 working days.`,
  });
}
