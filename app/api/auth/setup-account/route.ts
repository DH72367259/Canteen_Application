import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/setup-account
 * Body: { displayName: string; username: string; phone: string; password: string }
 *
 * Called after a student's first email OTP verification to complete their profile.
 * Saves name, unique username, and phone number; sets password; marks hasPassword = true.
 * After this, the student logs in with username+password or phone+password — no OTP needed.
 */
export async function POST(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { displayName?: string; username?: string; phone?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { displayName, username, phone, password } = body;

  // Validate required fields
  if (!password?.trim()) {
    return Response.json({ error: "Password is required" }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }
  if (!username?.trim()) {
    return Response.json({ error: "Username is required" }, { status: 400 });
  }
  const usernameClean = username.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(usernameClean)) {
    return Response.json({ error: "Username must be 3–20 characters: letters, numbers, or underscore only" }, { status: 400 });
  }
  if (!phone?.trim()) {
    return Response.json({ error: "Mobile number is required" }, { status: 400 });
  }
  const phoneDigits = phone.replace(/\D/g, "");
  const e164Phone = phoneDigits.length === 10 ? `+91${phoneDigits}` :
                    phoneDigits.length === 12 && phoneDigits.startsWith("91") ? `+${phoneDigits}` :
                    phone.startsWith("+") ? phone : `+${phoneDigits}`;

  const supabase = createAdminClient();

  // Check username uniqueness
  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", usernameClean)
    .maybeSingle();
  if (existing) {
    return Response.json({ error: "Username is already taken. Please choose a different one." }, { status: 409 });
  }

  // Check phone uniqueness — prevent two accounts sharing the same number
  const { data: existingPhone } = await supabase
    .from("profiles")
    .select("id")
    .eq("phone", e164Phone)
    .neq("id", ctx.uid)
    .maybeSingle();
  if (existingPhone) {
    return Response.json(
      { error: "This mobile number is already linked to another account. Please use a different number, or sign in with that number." },
      { status: 409 }
    );
  }

  // Step 1: Update profiles row first — if this fails, auth is untouched and user can retry.
  const updates: Record<string, string> = {
    username: usernameClean,
    phone: e164Phone,
  };
  if (displayName?.trim()) updates.name = displayName.trim();

  const { error: profileErr } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", ctx.uid);

  if (profileErr) {
    const msg = profileErr.message?.includes("unique")
      ? "Username or phone is already taken. Please choose a different one."
      : "Failed to save your profile. Please try again.";
    return Response.json({ error: msg }, { status: 409 });
  }

  // Step 2: Set password and confirm phone in auth — profile is already saved so
  // even if this call fails the user can retry and the profile update will be a no-op.
  const { error: updateErr } = await supabase.auth.admin.updateUserById(ctx.uid, {
    password,
    phone: e164Phone,
    phone_confirm: true,
    user_metadata: {
      has_password: true,
      password_changed_at: new Date().toISOString(),
      must_change_password: false,
    },
  });
  if (updateErr) {
    return Response.json({ error: "Profile saved but password setup failed. Please try again." }, { status: 500 });
  }

  return Response.json({ success: true });
}
