/**
 * POST /api/auth/otp/send
 *
 * Sends a 6-digit login OTP to the given email via Resend.
 *
 * Strategy: call Supabase admin.generateLink({ type: 'magiclink' }) which
 * produces the OTP *without* sending any email, then deliver it ourselves
 * via Resend. The client verifies the OTP the same way as always:
 *   supabase.auth.verifyOtp({ email, token, type: 'email' })
 *
 * Rate limits (Redis-backed, falls back to noop when Redis is unavailable):
 *   - 5 sends per email per hour
 *   - 20 sends per email per day
 *
 * Body: { email: string }
 * Response 200: { sent: true }
 * Response 429: { error: "Too many requests" }
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";
import { sendOtpEmail } from "@/lib/resend-client";
import { getRedisClient } from "@/lib/redis-client";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function checkRateLimit(email: string): Promise<boolean> {
  let redis: Awaited<ReturnType<typeof getRedisClient>> | null = null;
  try {
    redis = await getRedisClient();
  } catch {
    return true; // Redis unavailable — allow (fail open)
  }
  if (!redis) return true;

  try {
    const now = Math.floor(Date.now() / 1000);
    const hourKey = `otp:h:${email}:${Math.floor(now / 3600)}`;
    const dayKey = `otp:d:${email}:${Math.floor(now / 86400)}`;

    const [hourCount, dayCount] = await Promise.all([
      redis.get(hourKey),
      redis.get(dayKey),
    ]);

    if (Number(hourCount ?? 0) >= 5) return false;
    if (Number(dayCount ?? 0) >= 20) return false;

    await Promise.all([
      redis.setEx(hourKey, 3600, String(Number(hourCount ?? 0) + 1)),
      redis.setEx(dayKey, 86400, String(Number(dayCount ?? 0) + 1)),
    ]);
    return true;
  } catch {
    return true; // Redis op failed — allow
  }
}

export async function POST(request: Request) {
  let email: string;
  try {
    const body = await request.json();
    email = (body?.email ?? "").trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
  }

  const allowed = await checkRateLimit(email);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many OTP requests. Please wait before trying again." },
      { status: 429 }
    );
  }

  const supabase = createAdminClient();

  // generateLink produces the OTP without sending any email.
  // Creates a new user automatically if none exists with this email.
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (error || !data?.properties?.email_otp) {
    console.error("[otp/send] generateLink failed", error?.message);
    return NextResponse.json(
      { error: "Failed to generate OTP. Please try again." },
      { status: 500 }
    );
  }

  const otp = data.properties.email_otp;
  const sendErr = await sendOtpEmail(email, otp);
  if (sendErr) {
    console.error("[otp/send] Resend failed", sendErr);
    return NextResponse.json(
      { error: "Failed to send OTP email. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ sent: true });
}
