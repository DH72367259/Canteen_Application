/**
 * POST /api/auth/sms-otp/verify-reset
 *
 * Forgot-password SMS OTP verification.
 * Verifies the 6-digit code, then returns Supabase session credentials
 * for the ACTUAL user linked to this phone number (not a synthetic-email user).
 *
 * Flow:
 *  1. Verify code against sms_otp_codes (max 3 attempts)
 *  2. Look up user_id from profiles by phone
 *  3. Get the user's real auth email via admin.getUserById
 *  4. Call admin.generateLink({ type: 'magiclink', email }) to get a one-time OTP
 *  5. Return { email, supabase_otp } — client calls verifyOtp to get a session,
 *     then calls supabase.auth.updateUser({ password }) to reset.
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

  // Find latest unexpired, unverified OTP for this phone
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

  // Increment attempt counter before checking (prevents timing attacks)
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

  // Find the user account linked to this phone
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("phone", normalised)
    .maybeSingle<{ id: string }>();

  if (!profile) {
    return NextResponse.json({ error: "No account found for this number." }, { status: 404 });
  }

  // Get the user's actual auth email (not synthetic) so we generate a link for the right account
  const { data: authUser, error: userErr } = await supabase.auth.admin.getUserById(profile.id);
  if (userErr || !authUser?.user?.email) {
    console.error("[sms-otp/verify-reset] getUserById failed", userErr?.message);
    return NextResponse.json({ error: "Failed to locate account. Try again." }, { status: 500 });
  }

  const actualEmail = authUser.user.email;

  // Generate a one-time Supabase OTP for the user's real email → gives the client a session
  const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: actualEmail,
  });

  if (linkErr || !linkData?.properties?.email_otp) {
    console.error("[sms-otp/verify-reset] generateLink failed", linkErr?.message);
    return NextResponse.json({ error: "Session creation failed. Try again." }, { status: 500 });
  }

  return NextResponse.json({
    verified: true,
    email: actualEmail,
    supabase_otp: linkData.properties.email_otp,
  });
}
