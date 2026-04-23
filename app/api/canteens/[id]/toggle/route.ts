import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL         = process.env.NEXT_PUBLIC_SUPABASE_URL  || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

/**
 * PATCH /api/canteens/[id]/toggle
 * Body   : { is_active: boolean }
 * Auth   : Bearer <Supabase JWT>
 * Access : super_admin  –OR–  vendor/canteen_admin who owns this canteen
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: canteenId } = await params;

  if (!canteenId || canteenId === "demo") {
    // Supabase not yet wired – return success so the UI toggle still works
    const body = await req.json().catch(() => ({}));
    return Response.json({ canteen: { id: canteenId, is_active: body.is_active }, note: "demo mode" });
  }

  // ── Body validation ──────────────────────────────────────────────────────
  let is_active: unknown;
  try {
    is_active = (await req.json()).is_active;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (typeof is_active !== "boolean") {
    return Response.json({ error: "Body must contain { is_active: boolean }." }, { status: 400 });
  }

  // ── Graceful fallback when Supabase is not configured ─────────────────
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return Response.json({ canteen: { id: canteenId, is_active }, note: "Supabase not configured." });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // ── Auth: require a valid bearer token ──────────────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const token = authHeader.slice(7);
  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  // ── Role check: super_admin OR vendor/canteen_admin of THIS canteen ──────
  const { data: profile } = await admin
    .from("profiles")
    .select("role, canteen_id")
    .eq("id", user.id)
    .single();

  const role      = profile?.role      as string | undefined;
  const ownedId   = profile?.canteen_id as string | undefined;

  const allowed =
    role === "super_admin" ||
    ((role === "canteen_admin" || role === "vendor") && ownedId === canteenId);

  if (!allowed) {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }

  // ── Update canteen status ─────────────────────────────────────────────
  const { data, error } = await admin
    .from("canteens")
    .update({
      is_active,
      status:     is_active ? "open" : "closed",
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq("id", canteenId)
    .select("id, name, is_active, status")
    .single();

  if (error) {
    return Response.json({ error: "Database error: " + error.message }, { status: 500 });
  }

  return Response.json({ canteen: data });
}
