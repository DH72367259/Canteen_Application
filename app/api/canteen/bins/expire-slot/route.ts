import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";
import { releaseExpiredSlotBins } from "@/lib/slotExpiry";

export const dynamic = "force-dynamic";

/**
 * POST /api/canteen/bins/expire-slot
 *
 * Finds all occupied bins whose slot end time has passed and transitions them:
 *  - Order status → late_pickup (bin code snapshotted to bin_label/bin_color)
 *  - Physical bin → freed (is_occupied=false, available for next slot)
 *
 * Called automatically as a side-effect of live-orders and orders GET polls,
 * and can be triggered manually by the vendor dashboard.
 */
export async function POST(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["canteen_admin", "vendor", "co_admin", "super_admin", "worker"].includes(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const canteenId = ctx.canteenId;
  if (!canteenId) return NextResponse.json({ error: "No canteen associated" }, { status: 400 });

  const supabase = createAdminClient();
  const { released } = await releaseExpiredSlotBins(supabase, canteenId);

  return NextResponse.json({
    released,
    message: released > 0
      ? `${released} late pickup order${released !== 1 ? "s" : ""} moved — bins freed for next slot.`
      : "No expired slot bins found.",
  });
}
