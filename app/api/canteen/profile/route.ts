import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["canteen_admin", "vendor", "co_admin", "super_admin"];

export async function GET(request: Request) {
  const auth = await getRequestContext(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!ALLOWED_ROLES.includes(auth.role)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const canteenId = auth.canteenId;
  if (!canteenId) return NextResponse.json({ error: "canteenId required." }, { status: 400 });

  const supabase = createAdminClient();
  const [canteenRes, profileRes] = await Promise.all([
    supabase
      .from("canteens")
      .select("id, name, address, location, college, city")
      .eq("id", canteenId)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("phone")
      .eq("id", auth.uid)
      .maybeSingle(),
  ]);

  return NextResponse.json({
    canteen: canteenRes.data ?? null,
    phone: (profileRes.data as { phone?: string | null } | null)?.phone ?? "",
  });
}

export async function PATCH(request: Request) {
  const auth = await getRequestContext(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!ALLOWED_ROLES.includes(auth.role)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const canteenId = auth.canteenId;
  if (!canteenId) return NextResponse.json({ error: "canteenId required." }, { status: 400 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });

  const supabase = createAdminClient();
  const canteenUpdates: Record<string, unknown> = {};

  if (typeof body.name === "string" && body.name.trim()) canteenUpdates.name = body.name.trim();
  if (typeof body.address === "string") canteenUpdates.address = body.address.trim() || null;
  if (typeof body.location === "string") canteenUpdates.location = body.location.trim() || null;

  let hasWork = false;

  if (Object.keys(canteenUpdates).length > 0) {
    hasWork = true;
    canteenUpdates.updated_at = new Date().toISOString();
    const { error } = await supabase.from("canteens").update(canteenUpdates).eq("id", canteenId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (typeof body.phone === "string") {
    hasWork = true;
    const { error } = await supabase.from("profiles").update({ phone: body.phone.trim() || null }).eq("id", auth.uid);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!hasWork) return NextResponse.json({ error: "No editable fields supplied." }, { status: 400 });

  return NextResponse.json({ success: true });
}
