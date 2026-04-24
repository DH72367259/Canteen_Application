import { NextRequest } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const KEY_ID = process.env.RAZORPAY_KEY_ID || "";
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const MIN_TOPUP = 100; // ₹100 minimum

export async function POST(req: NextRequest) {
  // Auth check
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace("Bearer ", "").trim();
  if (!token) return Response.json({ error: "Unauthorised" }, { status: 401 });

  if (!KEY_ID || !KEY_SECRET) {
    return Response.json({ error: "Razorpay is not yet configured on this server. Contact support." }, { status: 503 });
  }

  let userId: string;
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return Response.json({ error: "Unauthorised" }, { status: 401 });
    userId = user.id;
  } catch {
    return Response.json({ error: "Auth verification failed" }, { status: 401 });
  }

  const body = await req.json();
  const amount = Math.round(Number(body.amount ?? 0));

  if (amount < MIN_TOPUP) {
    return Response.json({ error: `Minimum top-up amount is ₹${MIN_TOPUP}.` }, { status: 400 });
  }

  // Receipt ID — deterministic nonce using uid + timestamp + HMAC so it can't be guessed
  const receiptNonce = crypto
    .createHmac("sha256", KEY_SECRET)
    .update(`${userId}:${Date.now()}`)
    .digest("hex")
    .slice(0, 20);

  const rzpAuth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
  const resp = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { Authorization: `Basic ${rzpAuth}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: amount * 100, // paise
      currency: "INR",
      receipt: `wallet_${receiptNonce}`,
      notes: { purpose: "wallet_topup", userId },
    }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    return Response.json({ error: data.error?.description ?? "Order creation failed." }, { status: 502 });
  }
  return Response.json({ orderId: data.id, amount: data.amount, currency: data.currency, keyId: KEY_ID });
}
