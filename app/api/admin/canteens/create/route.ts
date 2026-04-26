import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/canteens/create
 * Body: {
 *   name, college, city, address, lat, lng, gmapLink,
 *   email,     // canteen manager login email
 *   password,  // static password set by admin
 * }
 * Access: super_admin only
 */
export async function POST(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx || ctx.role !== "super_admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, string>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name, college, city, address, lat, lng, gmapLink, email, password } = body;

  if (!name?.trim())     return Response.json({ error: "Canteen name is required" }, { status: 400 });
  if (!email?.trim())    return Response.json({ error: "Login email is required" }, { status: 400 });
  if (!password?.trim()) return Response.json({ error: "Password is required" }, { status: 400 });
  if (password.length < 8) return Response.json({ error: "Password must be at least 8 characters" }, { status: 400 });

  const supabase = createAdminClient();

  // 1. Create Supabase auth user — admin sets a permanent password; no forced change
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: email.trim().toLowerCase(),
    password,
    email_confirm: true,
    user_metadata: {
      has_password: true,
      password_changed_at: new Date().toISOString(),
    },
  });

  if (authError) {
    const msg = authError.message.includes("already registered")
      ? "A user with this email already exists."
      : "Failed to create user account.";
    return Response.json({ error: msg }, { status: 400 });
  }

  const userId = authData.user.id;

  // 2. Create canteen record in the canteens table
  const { data: canteen, error: canteenError } = await supabase
    .from("canteens")
    .insert({
      name:      name.trim(),
      college:   college?.trim() || null,
      city:      city?.trim() || null,
      address:   address?.trim() || null,
      lat:       lat ? parseFloat(lat) : null,
      lng:       lng ? parseFloat(lng) : null,
      gmap_link: gmapLink?.trim() || null,
      is_active: true,
      status:    "open",
    })
    .select("id, name")
    .single();

  if (canteenError) {
    // Rollback: delete the auth user we just created
    await supabase.auth.admin.deleteUser(userId);
    return Response.json({ error: "Failed to create canteen." }, { status: 500 });
  }

  // 3. Create / upsert profile for this user with canteen_admin role + canteen linkage
  const { error: profileError } = await supabase
    .from("profiles")
    .upsert({
      id:         userId,
      email:      email.trim().toLowerCase(),
      name:       name.trim() + " Manager",
      role:       "canteen_admin",
      canteen_id: canteen.id,
    });

  if (profileError) {
    // Rollback both
    await supabase.auth.admin.deleteUser(userId);
    await supabase.from("canteens").delete().eq("id", canteen.id);
    return Response.json({ error: "Failed to create user profile." }, { status: 500 });
  }

  return Response.json({
    success: true,
    canteen: { id: canteen.id, name: canteen.name },
    user:    { id: userId, email },
  });
}
