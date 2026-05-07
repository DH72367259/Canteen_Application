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

  const { data, error } = await supabase
    .from("bins")
    .update({
      is_occupied: false,
      order_id: null,
      assigned_order_id: null,
      slot_label: null,
      status: "empty",
      updated_at: new Date().toISOString(),
    })
    .eq("canteen_id", canteenId)
    .eq("is_occupied", true)
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const released = (data ?? []).length;
  return NextResponse.json({ released, message: `Released ${released} bins back to free.` });
}
