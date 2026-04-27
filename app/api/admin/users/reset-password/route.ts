import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { canMutateUsers } from "@/lib/roleChecks";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

// POST /api/admin/users/reset-password
// Body: { userId: string }
// Sends a password reset email to the user. Super admin only.
export async function POST(request: Request) {
  const context = await getRequestContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!canMutateUsers(context.role))
    return NextResponse.json({ error: "Only super_admin can reset passwords." }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body?.userId || typeof body.userId !== "string") {
    return NextResponse.json({ error: "userId is required." }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Look up the user's email from profiles
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", body.userId)
    .single();

  if (profileError || !profile?.email) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  // Generate a password reset link via Supabase admin
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXTAUTH_URL ?? "";
  const { error: resetError } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email: profile.email,
    options: {
      redirectTo: `${siteUrl}/reset-password`,
    },
  });

  if (resetError) {
    return NextResponse.json({ error: "Failed to generate reset link." }, { status: 500 });
  }

  return NextResponse.json({ success: true, message: `Password reset email sent to ${profile.email}.` });
}
