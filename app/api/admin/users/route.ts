import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { canViewAllUsers } from "@/lib/roleChecks";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let context;
  try {
    context = await getRequestContext(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!context) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!canViewAllUsers(context.role)) {
    return NextResponse.json({ error: "Super admin access required." }, { status: 403 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, email, role, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: "Failed to fetch users." }, { status: 500 });
  }

  const users = (data ?? []).map((u) => ({
    uid:   u.id,
    email: u.email,
    name:  u.name,
    role:  u.role,
    disabled: false,
    providerIds: ["email"],
  }));

  return NextResponse.json({ role: context!.role, users });
}
