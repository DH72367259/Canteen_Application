import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/resolve-username
 * Body: { username: string }
 *
 * Looks up a student's email address by their username so the client can
 * call supabase.auth.signInWithPassword({ email, password }).
 * Uses service-role client — never exposed to the browser's localStorage.
 *
 * Rate limit is enforced upstream in middleware.ts (120 req/min per IP).
 */
export async function POST(request: Request) {
  let body: { username?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const username = body.username?.trim().toLowerCase().replace(/^@/, "");
  if (!username || username.length < 3) {
    return Response.json({ error: "Username is required" }, { status: 400 });
  }
  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    return Response.json({ error: "Invalid username format" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Look up profile by username — returns the stored email (set during registration)
  const { data, error } = await supabase
    .from("profiles")
    .select("email")
    .eq("username", username)
    .maybeSingle();

  if (error) {
    return Response.json({ error: "Lookup failed. Please try again." }, { status: 500 });
  }
  if (!data?.email) {
    return Response.json({ error: "No account found with that username." }, { status: 404 });
  }

  return Response.json({ email: data.email });
}
