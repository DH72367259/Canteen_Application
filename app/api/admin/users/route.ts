import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { canViewAllUsers, canMutateUsers } from "@/lib/roleChecks";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

// ── GET /api/admin/users — list all users (super_admin + co_admin) ───────────
export async function GET(request: Request) {
  const context = await getRequestContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!canViewAllUsers(context.role)) return NextResponse.json({ error: "Access denied." }, { status: 403 });

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, email, phone, role, canteen_id, created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) return NextResponse.json({ error: "Failed to fetch users." }, { status: 500 });

  return NextResponse.json({
    role: context.role,
    isSuperAdmin: context.role === "super_admin",
    users: (data ?? []).map(u => ({
      uid: u.id, email: u.email, name: u.name, phone: u.phone,
      role: u.role, canteen_id: u.canteen_id, created_at: u.created_at,
    })),
  });
}

// ── POST /api/admin/users — create a new staff user (super_admin only) ───────
// Body: { email, password, name, role: "co_admin"|"canteen_admin"|"worker", canteen_id? }
export async function POST(request: Request) {
  const context = await getRequestContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!canMutateUsers(context.role)) return NextResponse.json({ error: "Only super_admin can create users." }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });

  const { email, password, name, role, canteen_id, phone, username } = body as Record<string, string>;
  if (!email?.trim())    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  if (!password?.trim()) return NextResponse.json({ error: "Password is required." }, { status: 400 });
  if ((password as string).length < 8) return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  if (!name?.trim())     return NextResponse.json({ error: "Name is required." }, { status: 400 });
  if (!phone?.trim())    return NextResponse.json({ error: "Phone number is required." }, { status: 400 });

  let usernameClean: string | null = null;
  if (username?.trim()) {
    usernameClean = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(usernameClean)) {
      return NextResponse.json({ error: "Username must be 3–20 characters: letters, numbers, or underscore only." }, { status: 400 });
    }
  }

  // Normalise phone to E.164 (assumes Indian numbers if no country code present).
  // Accept inputs like "9876543210", "+919876543210", "+1 555 010 1234" and reject
  // anything that doesn't end up as a valid 8-15 digit international number.
  const phoneRaw = phone.trim().replace(/[\s()\-]/g, "");
  let phoneNormalised: string;
  if (phoneRaw.startsWith("+")) {
    phoneNormalised = phoneRaw;
  } else if (/^[0-9]{10}$/.test(phoneRaw)) {
    phoneNormalised = `+91${phoneRaw}`;
  } else if (/^91[0-9]{10}$/.test(phoneRaw)) {
    phoneNormalised = `+${phoneRaw}`;
  } else {
    return NextResponse.json({ error: "Phone must be a valid 10-digit Indian number or include a country code (e.g. +919876543210)." }, { status: 400 });
  }
  if (!/^\+[0-9]{8,15}$/.test(phoneNormalised)) {
    return NextResponse.json({ error: "Phone format is invalid." }, { status: 400 });
  }

  const allowedRoles = ["co_admin", "canteen_admin", "vendor", "worker"];
  if (!role || !allowedRoles.includes(role)) {
    return NextResponse.json({ error: `Role must be one of: ${allowedRoles.join(", ")}.` }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: email.trim().toLowerCase(),
    password,
    email_confirm: true,
    user_metadata: {
      has_password: true,
      password_changed_at: new Date().toISOString(),
      ...(usernameClean ? { username: usernameClean } : {}),
    },
  });
  if (authError) {
    // Surface the real Supabase reason — this endpoint is super_admin only.
    console.error("[admin/users] auth.admin.createUser failed:", authError);
    const raw = (authError.message ?? "").toLowerCase();
    let msg: string;
    if (raw.includes("already registered") || raw.includes("already been registered") || raw.includes("already exists")) {
      msg = "A user with this email or phone already exists.";
    } else if (raw.includes("phone")) {
      msg = `Phone rejected by Supabase: ${authError.message}`;
    } else if (raw.includes("password")) {
      msg = `Password rejected by Supabase: ${authError.message}`;
    } else if (raw.includes("signup") && raw.includes("disabled")) {
      msg = "Email signups are disabled in Supabase project settings. Enable them in Authentication > Providers > Email.";
    } else {
      msg = `Failed to create user account: ${authError.message}`;
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const userId = authData.user.id;
  const profilePayload: Record<string, string | null> = {
    id: userId,
    email: email.trim().toLowerCase(),
    name: name.trim(),
    phone: phoneNormalised,
    role,
    canteen_id: canteen_id || null,
  };
  if (usernameClean) profilePayload.username = usernameClean;

  const { error: profileError } = await supabase.from("profiles").upsert(profilePayload);

  if (profileError) {
    await supabase.auth.admin.deleteUser(userId);
    // PostgreSQL unique_violation code 23505 means phone/email already taken.
    const isUniqueViolation = (profileError as { code?: string }).code === "23505";
    if (isUniqueViolation) {
      return NextResponse.json({ error: "A user with this phone number already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to create user profile." }, { status: 500 });
  }

  return NextResponse.json({ success: true, uid: userId, email: email.trim().toLowerCase(), name: name.trim(), phone: phoneNormalised, role, username: usernameClean });
}

// ── PATCH /api/admin/users — update user or reset password (super_admin only) ─
// Body: { uid, name?, role?, canteen_id?, new_password? }
export async function PATCH(request: Request) {
  const context = await getRequestContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!canMutateUsers(context.role)) return NextResponse.json({ error: "Only super_admin can modify users." }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });

  const { uid, name, role, canteen_id, new_password, phone, username } = body as Record<string, string>;
  if (!uid) return NextResponse.json({ error: "uid is required." }, { status: 400 });

  const supabase = createAdminClient();

  // Reset auth password if requested
  if (new_password) {
    if (new_password.length < 8) return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
    const { error: pwErr } = await supabase.auth.admin.updateUserById(uid, { password: new_password });
    if (pwErr) return NextResponse.json({ error: "Failed to reset password." }, { status: 500 });
    // Update metadata: keep has_password: true, refresh password_changed_at
    await supabase.auth.admin.updateUserById(uid, {
      user_metadata: { has_password: true, password_changed_at: new Date().toISOString(), must_change_password: false },
    });
  }

  // Update phone (auth + profile) if requested
  let phoneNormalised: string | null = null;
  if (phone !== undefined) {
    if (!phone?.trim()) return NextResponse.json({ error: "Phone cannot be empty." }, { status: 400 });
    const phoneRaw = phone.trim().replace(/[\s()\-]/g, "");
    if (phoneRaw.startsWith("+")) phoneNormalised = phoneRaw;
    else if (/^[0-9]{10}$/.test(phoneRaw)) phoneNormalised = `+91${phoneRaw}`;
    else if (/^91[0-9]{10}$/.test(phoneRaw)) phoneNormalised = `+${phoneRaw}`;
    else return NextResponse.json({ error: "Phone must be a valid 10-digit Indian number or include a country code." }, { status: 400 });
    if (!/^\+[0-9]{8,15}$/.test(phoneNormalised)) {
      return NextResponse.json({ error: "Phone format is invalid." }, { status: 400 });
    }
    const { error: phErr } = await supabase.auth.admin.updateUserById(uid, { phone: phoneNormalised, phone_confirm: true });
    if (phErr) {
      const raw = (phErr.message ?? "").toLowerCase();
      const msg = raw.includes("already") ? "Another user already has this phone number." : `Failed to update phone: ${phErr.message}`;
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  }

  // Update profile fields
  const update: Record<string, string | null> = {};
  if (name)  update.name = name.trim();
  if (role)  update.role = role;
  if (canteen_id !== undefined) update.canteen_id = canteen_id || null;
  if (phoneNormalised) update.phone = phoneNormalised;
  if (username !== undefined) {
    const usernameClean = username?.trim().toLowerCase() || null;
    if (usernameClean && !/^[a-z0-9_]{3,20}$/.test(usernameClean)) {
      return NextResponse.json({ error: "Username must be 3–20 characters: letters, numbers, or underscore only." }, { status: 400 });
    }
    update.username = usernameClean;
  }

  if (Object.keys(update).length > 0) {
    const { error: profileErr } = await supabase.from("profiles").update(update).eq("id", uid);
    if (profileErr) return NextResponse.json({ error: "Failed to update user profile." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// ── DELETE /api/admin/users — delete a user (super_admin only) ───────────────
// Body: { uid }
export async function DELETE(request: Request) {
  const context = await getRequestContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!canMutateUsers(context.role)) return NextResponse.json({ error: "Only super_admin can delete users." }, { status: 403 });

  const body = await request.json().catch(() => null);
  const uid = body?.uid as string | undefined;
  if (!uid) return NextResponse.json({ error: "uid is required." }, { status: 400 });

  // Prevent self-deletion
  if (uid === context.uid) return NextResponse.json({ error: "You cannot delete your own account." }, { status: 400 });

  const supabase = createAdminClient();

  // Cascade-delete dependents that reference profiles with ON DELETE RESTRICT
  // (orders.user_id, campaigns.created_by). Other deps cascade or set null.
  // Order matters: order_items / payments / cart rows must go before orders.
  // Service role bypasses RLS so this runs cleanly.
  try {
    // 1. Delete order_items rows whose order belongs to this user
    const { data: orderRows } = await supabase
      .from("orders").select("id").eq("user_id", uid);
    const orderIds = (orderRows ?? []).map(r => r.id as string);
    if (orderIds.length > 0) {
      await supabase.from("order_items").delete().in("order_id", orderIds);
      await supabase.from("payments").delete().in("order_id", orderIds);
    }
    // 2. Delete user's orders
    await supabase.from("orders").delete().eq("user_id", uid);
    // 3. Delete user's cart items
    await supabase.from("cart_items").delete().eq("user_id", uid);
    // 4. Delete campaigns created by this user (super-admin actions)
    await supabase.from("campaigns").delete().eq("created_by", uid);
    // 5. Delete support tickets created by this user (best-effort; safe if table absent)
    await supabase.from("support_tickets").delete().eq("created_by", uid);
  } catch (e) {
    console.warn("[admin/users DELETE] dependent cleanup warning:", e);
    // continue — auth.admin.deleteUser will surface a clear error if anything blocks
  }

  const { error } = await supabase.auth.admin.deleteUser(uid);
  if (error) {
    console.error("[admin/users DELETE] auth.admin.deleteUser failed:", error);
    return NextResponse.json({ error: `Failed to delete user: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

