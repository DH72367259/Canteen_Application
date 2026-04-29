import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * GET /api/canteen/live-orders
 *   Returns bins enriched with their currently-occupying order (if any),
 *   sorted Placed -> Preparing -> Accepted (per PDF), plus a flat list of
 *   active orders for the live-orders panel.
 */
export async function GET(request: Request) {
  const auth = await getRequestContext(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!["worker", "canteen_admin", "vendor", "co_admin", "super_admin"].includes(auth.role)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const url = new URL(request.url);
  const queryCanteenId = url.searchParams.get("canteenId");
  const canteenId =
    auth.role === "super_admin" || auth.role === "co_admin"
      ? (queryCanteenId ?? auth.canteenId ?? null)
      : (auth.canteenId ?? null);
  if (!canteenId) return NextResponse.json({ error: "canteenId required." }, { status: 400 });

  const supabase = createAdminClient();

  const { data: bins, error: binErr } = await supabase
    .from("bins")
    .select("id, bin_code, color, status, is_occupied, current_order_id, updated_at")
    .eq("canteen_id", canteenId)
    .order("bin_code");

  if (binErr) {
    return NextResponse.json({ error: "Failed to load bins." }, { status: 500 });
  }

  // Resilient: prod renamed `pickup_slot` -> `slot_label`. Try the new name
  // first; on missing-column error retry with the old name. Either gets
  // surfaced to the client as `pickup_slot` for backward compat.
  const slotCols = ["slot_label", "pickup_slot"] as const;
  let orders: unknown[] | null = null;
  let orderErr: { message: string } | null = null;
  for (const sc of slotCols) {
    const r = await supabase
      .from("orders")
      .select(`
        id, status, bin_id, ${sc}, total_amount, created_at, skipped_at,
        profiles(name),
        bins(bin_code, color),
        order_items(quantity, menu_items(name, is_meal))
      `)
      .eq("canteen_id", canteenId)
      .in("status", ["placed", "confirmed", "preparing", "ready_for_placement", "placed_in_bin", "ready_for_pickup"])
      .order("skipped_at", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: false })
      .limit(200);
    if (!r.error) {
      // Normalize the slot column to `pickup_slot` so downstream code is identical.
      orders = (r.data ?? []).map(row => {
        const obj = row as Record<string, unknown>;
        if (sc === "slot_label" && "slot_label" in obj) obj.pickup_slot = obj.slot_label;
        return obj;
      });
      orderErr = null;
      break;
    }
    orderErr = r.error;
    if (!/column .* does not exist/i.test(r.error.message)) break;
  }

  if (orderErr) {
    return NextResponse.json({ error: "Failed to load orders." }, { status: 500 });
  }

  // Sort order: Placed (oldest first) -> Preparing -> ready_for_placement
  const STATUS_RANK: Record<string, number> = {
    placed_in_bin: 0,
    ready_for_pickup: 1,
    placed: 2,
    confirmed: 3,
    preparing: 4,
    ready_for_placement: 5,
  };
  const sorted = (orders ?? []).slice().sort((a, b) => {
    const ra = STATUS_RANK[(a as { status: string }).status] ?? 99;
    const rb = STATUS_RANK[(b as { status: string }).status] ?? 99;
    return ra - rb;
  });

  return NextResponse.json({ bins: bins ?? [], orders: sorted });
}
