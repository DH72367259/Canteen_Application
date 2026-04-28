import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/canteens/[id]
 *   super_admin only — edit canteen metadata.
 *
 * DELETE /api/admin/canteens/[id]
 *   super_admin only — remove a canteen + cascade-clear linked profiles.
 */

const EDITABLE_FIELDS = new Set([
  "name", "college", "city", "address",
  "lat", "lng", "gmap_link",
  "status", "is_active",
]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await getRequestContext(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (ctx.role !== "super_admin") {
    return NextResponse.json({ error: "Only super_admin can edit canteens." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });

  const updates: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (EDITABLE_FIELDS.has(key)) updates[key] = body[key];
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No editable fields supplied." }, { status: 400 });
  }
  if ("status" in updates && !["open", "busy", "closed"].includes(updates.status as string)) {
    return NextResponse.json({ error: "status must be open, busy or closed." }, { status: 400 });
  }
  // Coerce numerics
  if ("lat" in updates && updates.lat !== null) updates.lat = Number(updates.lat);
  if ("lng" in updates && updates.lng !== null) updates.lng = Number(updates.lng);

  // Keep status and is_active consistent if only one was sent
  if ("is_active" in updates && !("status" in updates)) {
    updates.status = updates.is_active ? "open" : "closed";
  }
  if ("status" in updates && !("is_active" in updates)) {
    updates.is_active = updates.status !== "closed";
  }

  updates.updated_at = new Date().toISOString();
  updates.updated_by = ctx.uid;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("canteens")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    console.error("[admin/canteens PATCH] update failed:", error);
    return NextResponse.json({ error: `Failed to update canteen: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ canteen: data });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await getRequestContext(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (ctx.role !== "super_admin") {
    return NextResponse.json({ error: "Only super_admin can delete canteens." }, { status: 403 });
  }

  const supabase = createAdminClient();
  // Detach profiles linked to this canteen so we don't orphan FK references.
  await supabase.from("profiles").update({ canteen_id: null }).eq("canteen_id", id);

  const { error } = await supabase.from("canteens").delete().eq("id", id);
  if (error) {
    console.error("[admin/canteens DELETE] failed:", error);
    return NextResponse.json({ error: `Failed to delete canteen: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
