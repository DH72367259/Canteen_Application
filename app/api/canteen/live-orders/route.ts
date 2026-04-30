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

  // Resilient against prod schema drift: try the full Phase-1 column set,
  // fall back to a minimal projection if any column is missing. Without the
  // fallback a single missing column (color/status/is_occupied/current_order_id/updated_at)
  // would 500 the whole endpoint and leave Bin Management with "Failed to load bins."
  type BinRow = {
    id: string;
    bin_code: string;
    color: string | null;
    status: string | null;
    is_occupied: boolean;
    current_order_id: string | null;
    updated_at?: string;
  };
  let bins: BinRow[] | null = null;
  {
    const full = await supabase
      .from("bins")
      .select("id, bin_code, color, status, is_occupied, current_order_id, updated_at")
      .eq("canteen_id", canteenId)
      .order("bin_code");
    if (!full.error) {
      bins = (full.data ?? []) as BinRow[];
    } else {
      const minimal = await supabase
        .from("bins")
        .select("id, bin_code")
        .eq("canteen_id", canteenId)
        .order("bin_code");
      if (minimal.error) {
        return NextResponse.json({ error: `Failed to load bins: ${minimal.error.message}` }, { status: 500 });
      }
      bins = ((minimal.data ?? []) as Array<{ id: string; bin_code: string }>).map(b => ({
        id: b.id,
        bin_code: b.bin_code,
        color: null,
        status: null,
        is_occupied: false,
        current_order_id: null,
      }));
    }
  }

  // Resilient: prod renamed `pickup_slot` -> `slot_label` AND may not have
  // every Phase-1 column (skipped_at, total_amount). Try the rich projection
  // for each slot column, then progressively strip optional columns. Without
  // this any single missing column 500s the whole endpoint and Bin
  // Management / Live Orders show "Failed to load orders."
  const slotCols = ["slot_label", "pickup_slot"] as const;
  type ProjBuilder = (sc: string) => string;
  const richProj: ProjBuilder = (sc) => `
    id, status, bin_id, ${sc}, total_amount, created_at, skipped_at,
    profiles(name),
    bins!orders_bin_id_fkey(bin_code, color),
    order_items(quantity, menu_items(name, is_meal))
  `;
  const baseProj: ProjBuilder = (sc) => `
    id, status, bin_id, ${sc}, total_amount, created_at,
    profiles(name),
    bins!orders_bin_id_fkey(bin_code, color),
    order_items(quantity, menu_items(name, is_meal))
  `;
  const minimalProj: ProjBuilder = (sc) => `
    id, status, bin_id, ${sc}, created_at,
    order_items(quantity, menu_items(name, is_meal))
  `;
  let orders: unknown[] | null = null;
  let orderErr: { message: string } | null = null;
  outer: for (const sc of slotCols) {
    for (const proj of [richProj, baseProj, minimalProj]) {
      let q = supabase
        .from("orders")
        .select(proj(sc))
        .eq("canteen_id", canteenId)
        .in("status", ["placed", "confirmed", "preparing", "ready_for_placement", "placed_in_bin", "ready_for_pickup"]);
      if (proj === richProj) {
        q = q.order("skipped_at", { ascending: true, nullsFirst: true });
      }
      const r = await q.order("created_at", { ascending: false }).limit(200);
      if (!r.error) {
        orders = (r.data ?? []).map(row => {
          const obj = row as unknown as Record<string, unknown>;
          if (sc === "slot_label" && "slot_label" in obj) obj.pickup_slot = obj.slot_label;
          return obj;
        });
        orderErr = null;
        break outer;
      }
      orderErr = r.error;
      // Only retry on schema-shape errors; bail out on RLS/auth/etc.
      if (!/column .* does not exist/i.test(r.error.message)) break outer;
    }
  }

  if (orderErr) {
    return NextResponse.json({ error: `Failed to load orders: ${orderErr.message}` }, { status: 500 });
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
