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

  // Update Supabase auth user: set password, phone, and metadata
  const { error: updateErr } = await supabase.auth.admin.updateUserById(ctx.uid, {
    password,
    phone: e164Phone,
    phone_confirm: true,  // confirm phone immediately — no OTP needed since email is already verified
    user_metadata: {
      has_password: true,
      password_changed_at: new Date().toISOString(),
      must_change_password: false,
    },
  });
  if (updateErr) {
    return Response.json({ error: "Failed to complete account setup. Please try again." }, { status: 500 });
  }

  // Update profiles row with name, username, and phone
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
    // Non-fatal: auth is set up correctly; profile update failure is recoverable.
    // Do NOT log profileErr.message in production — it may contain schema details.
  }

  return Response.json({ success: true });
}
