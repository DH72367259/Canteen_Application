/**
 * POST /api/cron/password-expiry-notify
 *
 * Runs daily via an external scheduler (Railway Cron Job, cron-job.org, etc.).
 * Finds students whose password is 30 days old and sends them a reset-password
 * email (max 300 per run to stay well under the 500/day Supabase email limit).
 *
 * Setup:
 *  1. Add CRON_SECRET=<random-secret> to your Railway env vars
 *  2. Create a daily cron that calls:
 *       POST https://<your-app>.railway.app/api/cron/password-expiry-notify
 *       Authorization: Bearer <CRON_SECRET>
 *  3. Run the SQL migration once in Supabase SQL Editor:
 *       ALTER TABLE profiles
 *         ADD COLUMN IF NOT EXISTS password_notified_at timestamptz;
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const BATCH_SIZE = 300;

export async function POST(req: NextRequest) {
  // ── Auth guard — only the scheduler may call this ──────────────────────────
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Users due = registered 30+ days ago AND (never notified OR last notified 30+ days ago)
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: profiles, error: fetchError } = await supabase
    .from("profiles")
    .select("id, email")
    .eq("role", "user")
    .lte("created_at", cutoff)
    .or(`password_notified_at.is.null,password_notified_at.lte.${cutoff}`)
    .order("created_at", { ascending: true }) // oldest registrations first
    .limit(BATCH_SIZE);

  if (fetchError) {
    console.error("[cron:pw-expiry]", fetchError.message);
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  if (!profiles?.length) {
    return NextResponse.json({ sent: 0, message: "No users due for notification today." });
  }

  let sent = 0;
  const failed: string[] = [];
  const notifiedIds: string[] = [];

  for (const profile of profiles) {
    if (!profile.email) continue;

    // generateLink sends a password-reset email automatically via Supabase Auth
    const { error: linkError } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email: profile.email,
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/reset-password`,
      },
    });

    if (linkError) {
      failed.push(`${profile.email}: ${linkError.message}`);
    } else {
      sent++;
      notifiedIds.push(profile.id);
    }
  }

  // Mark all successfully notified users so they won't be picked up again for 30 days
  if (notifiedIds.length > 0) {
    await supabase
      .from("profiles")
      .update({ password_notified_at: new Date().toISOString() })
      .in("id", notifiedIds);
  }

  return NextResponse.json({
    sent,
    skipped: profiles.length - sent,
    total_due: profiles.length,
    ...(failed.length ? { errors: failed } : {}),
    message: `Password reset notification sent to ${sent} of ${profiles.length} users.`,
  });
}
