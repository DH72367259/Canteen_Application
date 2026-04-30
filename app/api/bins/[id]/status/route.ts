import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { canManageOrders } from "@/lib/roleChecks";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

// PATCH /api/bins/[id]/status
// Worker progressive flow: per-bin status transitions for the rack workflow.
//   reserved → occupied  (food physically placed in this bin)
//   occupied → empty     (vendor/manager mark-as-removed; emergency only)
//   any      → disabled  (admin only — bin out of service)
//   any      → empty     (admin reset)
// Body: { status: "occupied" | "empty" | "disabled" }
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await getRequestContext(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!canManageOrders(auth.role))
    return NextResponse.json({ error: "Access denied." }, { status: 403 });

  const { id: binId } = await context.params;
  let body: { status?: string };
  try { body = await request.json(); } catch { body = {}; }
  const next = String(body?.status ?? "").toLowerCase();
  const allowed = new Set(["occupied", "empty", "disabled"]);
  if (!allowed.has(next)) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: bin, error: binErr } = await supabase
    .from("bins")
    .select("id, canteen_id, status, assigned_order_id, current_order_id, is_occupied")
    .eq("id", binId)
    .single();
  if (binErr || !bin) return NextResponse.json({ error: "Bin not found." }, { status: 404 });

  if (auth.canteenId && bin.canteen_id !== auth.canteenId) {
    return NextResponse.json({ error: "Access denied." }, { status: 403 });
  }

  const updates: Record<string, unknown> = {
    status: next,
    updated_at: new Date().toISOString(),
  };

  if (next === "empty") {
    updates.is_occupied = false;
    updates.assigned_order_id = null;
    updates.current_order_id = null;
    updates.order_id = null;
  } else if (next === "occupied") {
    updates.is_occupied = true;
  } else if (next === "disabled") {
    // Don't touch occupancy — admin may disable an empty bin for cleaning.
  }

  const { error: updErr } = await supabase.from("bins").update(updates).eq("id", binId);
  if (updErr) return NextResponse.json({ error: "Failed to update bin." }, { status: 500 });

  return NextResponse.json({ success: true, binId, status: next });
}
