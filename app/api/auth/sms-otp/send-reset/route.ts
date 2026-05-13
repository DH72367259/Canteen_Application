/**
 * POST /api/auth/sms-otp/send-reset
 *
 * Forgot-password via SMS OTP.
 * Only sends OTP if the phone number is already registered in profiles.
 * Returns a generic error if not found (no account enumeration beyond rate limiting).
 *
 * Body:   { phone: string }
 * Returns { sent: true } on success
 */
import { NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase-server";
import { sendSmsOtp } from "@/lib/fast2sms";
import { getRedisClient } from "@/lib/redis-client";

export const dynamic = "force-dynamic";

const PHONE_RE = /^\+?91?\d{10}$/;

function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^91/, "");
  return `+91${digits}`;
}

function generateOtp(): string {
  return String(Math.floor(100000 + crypto.randomInt(900000)));
}

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

async function checkRateLimit(phone: string): Promise<boolean> {
  let redis: Awaited<ReturnType<typeof getRedisClient>> | null = null;
  try { redis = await getRedisClient(); } catch { return true; }
  if (!redis) return true;
  try {
    const now = Math.floor(Date.now() / 1000);
    const hKey = `sms_reset:h:${phone}:${Math.floor(now / 3600)}`;
    const dKey = `sms_reset:d:${phone}:${Math.floor(now / 86400)}`;
    const [hc, dc] = await Promise.all([redis.get(hKey), redis.get(dKey)]);
    if (Number(hc ?? 0) >= 3 || Number(dc ?? 0) >= 5) return false;
    await Promise.all([
      redis.setEx(hKey, 3600,  String(Number(hc ?? 0) + 1)),
      redis.setEx(dKey, 86400, String(Number(dc ?? 0) + 1)),
    ]);
    return true;
  } catch { return true; }
}

export async function POST(request: Request) {
  let phone: string;
  try {
    const body = await request.json();
    phone = (body?.phone ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!phone || !PHONE_RE.test(phone.replace(/\s/g, ""))) {
    return NextResponse.json({ error: "Valid Indian mobile number required" }, { status: 400 });
  }

  const normalised = normalisePhone(phone);

  const allowed = await checkRateLimit(normalised);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many reset attempts. Please wait before trying again." },
      { status: 429 }
    );
  }

  const supabase = createAdminClient();

  // Check if this phone is registered in profiles
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("phone", normalised)
    .maybeSingle<{ id: string }>();

  if (!profile) {
    return NextResponse.json(
      { error: "No account found with this mobile number. Please register first." },
      { status: 404 }
    );
  }

  const code = generateOtp();
  const codeHash = hashCode(code);

  const { error: insertErr } = await supabase.from("sms_otp_codes").insert({
    phone: normalised,
    code_hash: codeHash,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
  if (insertErr) {
    console.error("[sms-otp/send-reset] DB insert failed", insertErr.message);
    return NextResponse.json({ error: "Failed to create OTP. Try again." }, { status: 500 });
  }

  const sendErr = await sendSmsOtp(normalised, code);
  if (sendErr) {
    console.error("[sms-otp/send-reset] Fast2SMS failed", sendErr);
    return NextResponse.json({ error: "Failed to send SMS. Try again." }, { status: 500 });
  }

  return NextResponse.json({ sent: true });
}
