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
    // Use SELECT * so we transparently work whether prod has `current_order_id`
    // (legacy) or `assigned_order_id` (post-Phase-8) — and any other column
    // drift. This single query supersedes the previous full+minimal fallback,
    // which was 500-ing on the missing-column path and rendering empty bins.
    const r = await supabase
      .from("bins")
      .select("*")
      .eq("canteen_id", canteenId)
      .order("bin_code");
    if (r.error) {
      return NextResponse.json({ error: `Failed to load bins: ${r.error.message}` }, { status: 500 });
    }
    bins = ((r.data ?? []) as Array<Record<string, unknown>>).map(b => ({
      id: String(b.id ?? ""),
      bin_code: String(b.bin_code ?? ""),
      color: (b.color as string | null) ?? null,
      status: (b.status as string | null) ?? null,
      is_occupied: Boolean(b.is_occupied),
      current_order_id:
        (b.current_order_id as string | null) ??
        (b.assigned_order_id as string | null) ??
        (b.order_id as string | null) ??
        null,
      updated_at: b.updated_at as string | undefined,
    }));
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
    profiles!orders_user_id_fkey(name),
    bins!orders_bin_id_fkey(bin_code, color),
    order_items(id, menu_item_id, quantity, cancelled_quantity, unit_price, menu_items(name, is_meal))
  `;
  const baseProj: ProjBuilder = (sc) => `
    id, status, bin_id, ${sc}, total_amount, created_at,
    profiles!orders_user_id_fkey(name),
    bins!orders_bin_id_fkey(bin_code, color),
    order_items(id, menu_item_id, quantity, cancelled_quantity, unit_price, menu_items(name, is_meal))
  `;
  const legacyItemProj: ProjBuilder = (sc) => `
    id, status, bin_id, ${sc}, total_amount, created_at,
    profiles!orders_user_id_fkey(name),
    bins!orders_bin_id_fkey(bin_code, color),
    order_items(id, menu_item_id, quantity, unit_price, menu_items(name, is_meal))
  `;
  const minimalProj: ProjBuilder = (sc) => `
    id, status, bin_id, ${sc}, created_at,
    order_items(id, menu_item_id, quantity, unit_price, menu_items(name, is_meal))
  `;
  let orders: unknown[] | null = null;
  let orderErr: { message: string } | null = null;
  outer: for (const sc of slotCols) {
    for (const proj of [richProj, baseProj, legacyItemProj, minimalProj]) {
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

  // Auto-release bins whose orders have reached a terminal state.
  // Runs on every poll (every 5s) so stale bins are freed without manual intervention.
  {
    const occupiedBinIds = (bins ?? [])
      .filter(b => b.is_occupied && b.current_order_id)
      .map(b => b.current_order_id as string);

    if (occupiedBinIds.length > 0) {
      const { data: doneOrders } = await supabase
        .from("orders")
        .select("id, bin_id")
        .in("id", occupiedBinIds)
        .in("status", ["collected", "cancelled", "failed", "refunded"]);

      const staleOrderIds = (doneOrders ?? []).map(o => o.id);
      if (staleOrderIds.length > 0) {
        await supabase
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
          .in("order_id", staleOrderIds);

        // Refresh bins list after cleanup so the response reflects freed bins
        const refreshed = await supabase
          .from("bins")
          .select("*")
          .eq("canteen_id", canteenId)
          .order("bin_code");
        if (!refreshed.error) {
          bins = ((refreshed.data ?? []) as Array<Record<string, unknown>>).map(b => ({
            id: String(b.id ?? ""),
            bin_code: String(b.bin_code ?? ""),
            color: (b.color as string | null) ?? null,
            status: (b.status as string | null) ?? null,
            is_occupied: Boolean(b.is_occupied),
            current_order_id:
              (b.current_order_id as string | null) ??
              (b.assigned_order_id as string | null) ??
              (b.order_id as string | null) ??
              null,
            updated_at: b.updated_at as string | undefined,
          }));
        }
      }
    }
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
