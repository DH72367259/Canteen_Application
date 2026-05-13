/**
 * POST /api/auth/sms-otp/verify
 *
 * Verifies the 6-digit SMS OTP and returns Supabase auth credentials
 * so the client can call supabase.auth.verifyOtp() to create a session.
 *
 * Flow:
 *  1. Verify code hash against sms_otp_codes table (max 3 attempts)
 *  2. Find or create a Supabase user for the phone number
 *  3. Call admin.generateLink() to get a one-time Supabase OTP
 *  4. Return { email, supabase_otp } — client calls verifyOtp() with these
 *
 * Client usage (in login page):
 *   const { email, supabase_otp } = await res.json()
 *   await supabase.auth.verifyOtp({ email, token: supabase_otp, type: 'email' })
 *
 * Body:   { phone: string, code: string }
 * Returns { verified: true, email: string, supabase_otp: string }
 */
import { NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const PHONE_RE = /^\+?91?\d{10}$/;
const MAX_ATTEMPTS = 3;

function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^91/, "");
  return `+91${digits}`;
}

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function syntheticEmail(phone: string): string {
  // Stable synthetic email for phone-only users. Never actually receives mail.
  const digits = phone.replace(/\D/g, "");
  return `${digits}@sms.noqx.co.in`;
}

export async function POST(request: Request) {
  let phone: string, code: string;
  try {
    const body = await request.json();
    phone = (body?.phone ?? "").trim();
    code  = (body?.code  ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!phone || !PHONE_RE.test(phone.replace(/\s/g, ""))) {
    return NextResponse.json({ error: "Valid phone number required" }, { status: 400 });
  }
  if (!code || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "6-digit code required" }, { status: 400 });
  }

  const normalised = normalisePhone(phone);
  const supabase   = createAdminClient();

  // Find latest unexpired OTP for this phone
  const { data: otpRow, error: fetchErr } = await supabase
    .from("sms_otp_codes")
    .select("id, code_hash, attempts, verified_at")
    .eq("phone", normalised)
    .gt("expires_at", new Date().toISOString())
    .is("verified_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; code_hash: string; attempts: number; verified_at: string | null }>();

  if (fetchErr) {
    return NextResponse.json({ error: "Verification failed. Try again." }, { status: 500 });
  }
  if (!otpRow) {
    return NextResponse.json({ error: "OTP expired or not found. Request a new code." }, { status: 400 });
  }
  if (otpRow.attempts >= MAX_ATTEMPTS) {
    return NextResponse.json({ error: "Too many incorrect attempts. Request a new code." }, { status: 429 });
  }

  // Increment attempt counter first (prevents timing attacks)
  await supabase
    .from("sms_otp_codes")
    .update({ attempts: otpRow.attempts + 1 })
    .eq("id", otpRow.id);

  const inputHash = hashCode(code);
  if (!crypto.timingSafeEqual(Buffer.from(inputHash), Buffer.from(otpRow.code_hash))) {
    const remaining = MAX_ATTEMPTS - (otpRow.attempts + 1);
    return NextResponse.json(
      { error: `Incorrect code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.` },
      { status: 400 }
    );
  }

  // Mark OTP as verified
  await supabase
    .from("sms_otp_codes")
    .update({ verified_at: new Date().toISOString() })
    .eq("id", otpRow.id);

  // Find or create Supabase user for this phone number
  const email = syntheticEmail(normalised);

  // generateLink creates the user if they don't exist, and returns a one-time OTP
  const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (linkErr || !linkData?.properties?.email_otp) {
    console.error("[sms-otp/verify] generateLink failed", linkErr?.message);
    return NextResponse.json({ error: "Session creation failed. Try again." }, { status: 500 });
  }

  // Ensure profile row exists for this user (role defaults to 'user')
  const userId = linkData.user?.id;
  if (userId) {
    await supabase
      .from("profiles")
      .upsert({ id: userId, phone: normalised, role: "user" }, { onConflict: "id", ignoreDuplicates: true });
  }

  return NextResponse.json({
    verified: true,
    email,
    supabase_otp: linkData.properties.email_otp,
  });
}
