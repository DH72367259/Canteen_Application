import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";

export async function POST(req: Request) {
  const ctx = await getRequestContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "canteen_admin" && ctx.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const canteenId = ctx.canteenId;
  if (!canteenId) return NextResponse.json({ error: "No canteen associated" }, { status: 400 });

  const supabase = createAdminClient();

  const now = new Date().toISOString();
  // Try with order_id first (production schema); fall back to current_order_id (staging variant)
  let data: { id: string }[] | null = null;
  for (const payload of [
    { is_occupied: false, order_id: null, assigned_order_id: null, slot_label: null, status: "empty", updated_at: now },
    { is_occupied: false, current_order_id: null, assigned_order_id: null, slot_label: null, status: "empty", updated_at: now },
  ] as const) {
    const r = await supabase.from("bins").update(payload).eq("canteen_id", canteenId).eq("is_occupied", true).select("id");
    if (!r.error) { data = r.data as { id: string }[]; break; }
    const isSchemaErr = /column .* does not exist/i.test(r.error.message) || r.error.code === "42703" || r.error.code === "PGRST204";
    if (!isSchemaErr) return NextResponse.json({ error: r.error.message }, { status: 500 });
  }

  const released = (data ?? []).length;
  return NextResponse.json({ released, message: `Released ${released} bins back to free.` });
}
