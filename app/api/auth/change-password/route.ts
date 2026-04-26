import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/change-password
 * Body: { password: string }
 * Access: any authenticated user (changes THEIR OWN password)
 */
export async function POST(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { password } = body;
  if (!password?.trim())    return Response.json({ error: "Password is required" }, { status: 400 });
  if (password.length < 8)  return Response.json({ error: "Password must be at least 8 characters" }, { status: 400 });

  // Use admin client to update the user's password and clear the forced-change flag
  const supabase = createAdminClient();
  const { error } = await supabase.auth.admin.updateUserById(ctx.uid, {
    password,
    user_metadata: {
      must_change_password: false,
      has_password: true,
      password_changed_at: new Date().toISOString(),
    },
  });

  if (error) {
    return Response.json({ error: "Failed to update password. Please try again." }, { status: 500 });
  }

  return Response.json({ success: true });
}
