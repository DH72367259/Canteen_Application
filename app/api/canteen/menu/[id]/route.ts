import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const ALLOWED_AVAIL = ["slot_based", "batched_prepared"] as const;

function canEdit(role: string): boolean {
  return role === "canteen_admin" || role === "vendor" ||
         role === "co_admin" || role === "super_admin";
}

async function ensureCanteenScope(
  supabase: ReturnType<typeof createAdminClient>,
  itemId: string,
  auth: { role: string; canteenId?: string },
): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (auth.role === "super_admin" || auth.role === "co_admin") return { ok: true };
  const { data } = await supabase.from("menu_items").select("canteen_id").eq("id", itemId).single();
  if (!data) return { ok: false, status: 404, error: "Item not found." };
  if (data.canteen_id !== auth.canteenId) return { ok: false, status: 403, error: "Forbidden." };
  return { ok: true };
}

// PATCH /api/canteen/menu/[id]
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await getRequestContext(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!canEdit(auth.role)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });

  const supabase = createAdminClient();
  const scope = await ensureCanteenScope(supabase, id, auth);
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });

  const allowedKeys = [
    "name", "description", "price", "category", "image_url",
    "availability_type", "quantity_per_slot", "total_per_day",
    "is_meal", "is_hidden", "is_sold_out", "is_available",
  ];
  const updates: Record<string, unknown> = {};
  for (const k of allowedKeys) {
    if (k in body) updates[k] = body[k];
  }
  if ("availability_type" in updates &&
      !(ALLOWED_AVAIL as readonly string[]).includes(String(updates.availability_type))) {
    return NextResponse.json({ error: "Invalid availability_type." }, { status: 400 });
  }
  if ("price" in updates) {
    const p = Number(updates.price);
    if (!Number.isFinite(p) || p < 0) {
      return NextResponse.json({ error: "Invalid price." }, { status: 400 });
    }
    updates.price = p;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No editable fields." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("menu_items")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) {
    console.error("[PATCH /api/canteen/menu/:id] update failed:", error);
    return NextResponse.json({ error: error?.message || "Failed to update item." }, { status: 500 });
  }
  return NextResponse.json({ item: data });
}

// DELETE /api/canteen/menu/[id]
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await getRequestContext(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!canEdit(auth.role)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const { id } = await context.params;
  const supabase = createAdminClient();
  const scope = await ensureCanteenScope(supabase, id, auth);
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });

  const { error } = await supabase.from("menu_items").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "Failed to delete item." }, { status: 500 });
  return NextResponse.json({ success: true });
}
