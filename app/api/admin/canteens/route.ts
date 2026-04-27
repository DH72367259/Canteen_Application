import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { canViewAllUsers } from "@/lib/roleChecks";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

// GET /api/admin/canteens — list all canteens (for dropdowns in admin UI)
export async function GET(request: Request) {
  const context = await getRequestContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!canViewAllUsers(context.role))
    return NextResponse.json({ error: "Access denied." }, { status: 403 });

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("canteens")
    .select("id, name, city, college, is_active")
    .order("name");

  if (error) return NextResponse.json({ error: "Failed to fetch canteens." }, { status: 500 });

  return NextResponse.json({ canteens: data ?? [] });
}
