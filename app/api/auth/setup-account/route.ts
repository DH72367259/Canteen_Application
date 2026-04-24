import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/setup-account
 * Body: { displayName: string; password: string; email?: string }
 *
 * Called after a student's first OTP verification to set their display name,
 * password, and optionally email (required for phone-only users).
 * Sets user_metadata.has_password = true and password_changed_at = now.
 */
export async function POST(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { displayName?: string; password?: string; email?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { displayName, password, email } = body;

  if (!password?.trim()) {
    return Response.json({ error: "Password is required" }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Build the admin update payload
  type UpdatePayload = Parameters<typeof supabase.auth.admin.updateUserById>[1];
  const updatePayload: UpdatePayload = {
    password,
    user_metadata: {
      has_password: true,
      password_changed_at: new Date().toISOString(),
      must_change_password: false,
    },
  };

  // Phone-only users must provide an email for future password logins
  if (email?.trim()) {
    updatePayload.email = email.trim();
    // Bypass email confirmation so they can log in immediately
    updatePayload.email_confirm = true;
  }

  const { error: updateErr } = await supabase.auth.admin.updateUserById(ctx.uid, updatePayload);
  if (updateErr) {
    return Response.json({ error: updateErr.message }, { status: 500 });
  }

  // Update display name in profiles
  if (displayName?.trim()) {
    await supabase
      .from("profiles")
      .update({ name: displayName.trim() })
      .eq("id", ctx.uid);
  }

  return Response.json({ success: true });
}
