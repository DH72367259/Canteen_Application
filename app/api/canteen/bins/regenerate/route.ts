import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";
import { reconcileBinsForCanteen } from "@/lib/binProvisioning";

export const dynamic = "force-dynamic";

// POST /api/canteen/bins/regenerate
// Reconciles the bin rack to match slot_control.max_bins exactly:
// deletes idle surplus bins and inserts any missing target bins.
// Bins linked to live orders are kept.
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

  const { deleted, inserted } = await reconcileBinsForCanteen(supabase, canteenId, maxBins);
  return NextResponse.json({ success: true, canteenId, maxBins, deleted, inserted });
}
