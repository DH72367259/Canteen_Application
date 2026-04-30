import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";
import { ensureBinsForCanteen } from "@/lib/binProvisioning";

export const dynamic = "force-dynamic";

// POST /api/canteen/bins/regenerate
// Wipes idle bins for the caller's canteen and re-creates the colour-rack
// rows from slot_control.max_bins. Bins linked to live orders are kept.
// Body (optional): { canteenId?: string }  — required for super_admin/co_admin.
export async function POST(request: Request) {
  const auth = await getRequestContext(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const allowed = ["canteen_admin", "vendor", "co_admin", "super_admin"];
  if (!allowed.includes(auth.role)) {
    return NextResponse.json({ error: "Access denied." }, { status: 403 });
  }

  let body: { canteenId?: string } = {};
  try { body = await request.json(); } catch { /* ignore */ }

  const canteenId = (auth.role === "super_admin" || auth.role === "co_admin")
    ? (body.canteenId ?? auth.canteenId ?? null)
    : (auth.canteenId ?? null);
  if (!canteenId) return NextResponse.json({ error: "canteenId required." }, { status: 400 });

  const supabase = createAdminClient();
  const { data: sc } = await supabase
    .from("slot_control")
    .select("max_bins")
    .eq("canteen_id", canteenId)
    .single();
  const maxBins = Number(sc?.max_bins) || 60;

  // Drop idle bins so the rack snaps to the new size, then re-provision.
  await supabase
    .from("bins")
    .delete()
    .eq("canteen_id", canteenId)
    .eq("is_occupied", false)
    .is("assigned_order_id", null);

  const inserted = await ensureBinsForCanteen(supabase, canteenId, maxBins);
  return NextResponse.json({ success: true, canteenId, maxBins, inserted });
}
