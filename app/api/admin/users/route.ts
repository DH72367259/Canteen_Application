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
    .select("id, name, email, role, canteen_id, created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) return NextResponse.json({ error: "Failed to fetch users." }, { status: 500 });

  return NextResponse.json({
    role: context.role,
    isSuperAdmin: context.role === "super_admin",
    users: (data ?? []).map(u => ({
      uid: u.id, email: u.email, name: u.name,
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

  const { email, password, name, role, canteen_id } = body as Record<string, string>;
  if (!email?.trim())    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  if (!password?.trim()) return NextResponse.json({ error: "Password is required." }, { status: 400 });
  if ((password as string).length < 8) return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  if (!name?.trim())     return NextResponse.json({ error: "Name is required." }, { status: 400 });

  const allowedRoles = ["co_admin", "canteen_admin", "vendor", "worker"];
  if (!role || !allowedRoles.includes(role)) {
    return NextResponse.json({ error: `Role must be one of: ${allowedRoles.join(", ")}.` }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: email.trim().toLowerCase(),
    password,
    email_confirm: true,
    user_metadata: { has_password: true, password_changed_at: new Date().toISOString() },
  });
  if (authError) {
    const msg = authError.message.includes("already registered")
      ? "A user with this email already exists."
      : "Failed to create user account.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const userId = authData.user.id;
  const { error: profileError } = await supabase.from("profiles").upsert({
    id: userId,
    email: email.trim().toLowerCase(),
    name: name.trim(),
    role,
    canteen_id: canteen_id || null,
  });

  if (profileError) {
    await supabase.auth.admin.deleteUser(userId);
    return NextResponse.json({ error: "Failed to create user profile." }, { status: 500 });
  }

  return NextResponse.json({ success: true, uid: userId, email: email.trim().toLowerCase(), name: name.trim(), role });
}

// ── PATCH /api/admin/users — update user or reset password (super_admin only) ─
// Body: { uid, name?, role?, canteen_id?, new_password? }
export async function PATCH(request: Request) {
  const context = await getRequestContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!canMutateUsers(context.role)) return NextResponse.json({ error: "Only super_admin can modify users." }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });

  const { uid, name, role, canteen_id, new_password } = body as Record<string, string>;
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

  // Update profile fields
  const update: Record<string, string | null> = {};
  if (name)  update.name = name.trim();
  if (role)  update.role = role;
  if (canteen_id !== undefined) update.canteen_id = canteen_id || null;

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
  const { error } = await supabase.auth.admin.deleteUser(uid);
  if (error) return NextResponse.json({ error: "Failed to delete user." }, { status: 500 });

  return NextResponse.json({ success: true });
}

