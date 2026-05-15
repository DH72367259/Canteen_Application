/**
 * Slot-expiry — immediate late pickup.
 *
 * When a slot's end time passes, every active order in that slot moves
 * straight to `late_pickup` regardless of whether the worker marked it
 * as placed-in-bin. The bin (if any) is freed immediately so it can be
 * reused by the next slot.
 *
 *   ANY active status  →  (slot ends)  →  late_pickup
 *
 * Source of truth: orders.slot_label + orders.status.
 * Does NOT rely on bins table columns (avoids prod schema drift issues).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

function nowISTMinutes(): number {
  const now = new Date();
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

/**
 * Parse the END time from a slot label.
 * Handles both 12-hour "9:00 AM - 9:15 AM" and 24-hour "09:00 - 09:15".
 * Returns minutes-since-midnight (IST) or null if not parseable.
 */
export function parseSlotEndMinutes(slotLabel: string): number | null {
  // 12-hour AM/PM: "... - 9:15 PM"
  const m12 = slotLabel.match(/[-–]\s*(\d+):(\d+)\s*(AM|PM)/i);
  if (m12) {
    let h = parseInt(m12[1], 10);
    const min = parseInt(m12[2], 10);
    const isPm = m12[3].toUpperCase() === "PM";
    if (isPm && h !== 12) h += 12;
    if (!isPm && h === 12) h = 0;
    return h * 60 + min;
  }

  // 24-hour: "09:00 - 09:15" or "09:00–09:15"
  const m24 = slotLabel.match(/[-–]\s*(\d{1,2}):(\d{2})\s*$/);
  if (m24) {
    const h = parseInt(m24[1], 10);
    const min = parseInt(m24[2], 10);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return h * 60 + min;
  }

  return null;
}

type ActiveOrder = {
  id: string;
  status: string;
  slot_label: string | null;
  bin_id: string | null;
};

/**
 * Move every active order whose slot has ended to `late_pickup` immediately.
 * Frees the associated bin so it is available for the next slot right away.
 */
export async function releaseExpiredSlotBins(
  supabase: SupabaseClient,
  canteenId: string,
): Promise<{ released: number }> {
  const { data: activeOrders, error } = await supabase
    .from("orders")
    .select("id, status, slot_label, bin_id")
    .eq("canteen_id", canteenId)
    .in("status", [
      "placed", "confirmed", "preparing",
      "ready_for_placement", "placed_in_bin", "ready_for_pickup",
    ]);

  if (error) {
    console.warn("[releaseExpiredSlotBins] query failed:", error.message);
    return { released: 0 };
  }
  if (!activeOrders?.length) return { released: 0 };

  const nowMin = nowISTMinutes();
  const nowIso = new Date().toISOString();

  const expiredOrders = (activeOrders as unknown as ActiveOrder[]).filter(o => {
    const endMin = parseSlotEndMinutes(String(o.slot_label ?? ""));
    return endMin !== null && nowMin >= endMin;
  });

  if (!expiredOrders.length) return { released: 0 };

  const expiredIds = expiredOrders.map(o => o.id);
  const binIds = [...new Set(expiredOrders.map(o => o.bin_id).filter((id): id is string => !!id))];

  // Move ALL expired orders directly to late_pickup in one query
  await supabase
    .from("orders")
    .update({ status: "late_pickup", updated_at: nowIso })
    .in("id", expiredIds)
    .in("status", [
      "placed", "confirmed", "preparing",
      "ready_for_placement", "placed_in_bin", "ready_for_pickup",
    ]);

  // Free all associated bins immediately
  if (binIds.length > 0) {
    await supabase
      .from("bins")
      .update({
        is_occupied: false,
        order_id: null,
        assigned_order_id: null,
        status: "empty",
        updated_at: nowIso,
      })
      .in("id", binIds);
  }

  return { released: expiredOrders.length };
}

/**
 * End-of-day auto-close.
 * `late_pickup` orders from previous days → collected.
 * `late_pickup_pending` orders from previous days → bins freed + collected.
 */
export async function autoCloseEodLateOrders(
  supabase: SupabaseClient,
  canteenId: string,
): Promise<{ closed: number }> {
  const now = new Date();
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  const midnightIST = new Date(
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 0, 0, 0) -
    5.5 * 60 * 60 * 1000,
  );
  const midnightIso = midnightIST.toISOString();
  const nowIso = now.toISOString();

  const { data: lateOrders } = await supabase
    .from("orders")
    .select("id")
    .eq("canteen_id", canteenId)
    .in("status", ["late_pickup", "late_pickup_pending"])
    .lt("updated_at", midnightIso);

  if (!lateOrders?.length) return { closed: 0 };

  const ids = lateOrders.map((o: { id: string }) => o.id);

  // Also free any bins still linked to these orders
  const { data: staleOrders } = await supabase
    .from("orders")
    .select("bin_id")
    .in("id", ids)
    .not("bin_id", "is", null);

  const staleBinIds = (staleOrders ?? [])
    .map((o: { bin_id?: string | null }) => o.bin_id)
    .filter((id): id is string => !!id);

  await supabase
    .from("orders")
    .update({ status: "collected", updated_at: nowIso })
    .in("id", ids);

  if (staleBinIds.length) {
    await supabase
      .from("bins")
      .update({
        is_occupied: false, order_id: null,
        assigned_order_id: null, status: "empty", updated_at: nowIso,
      })
      .in("id", staleBinIds);
  }

  return { closed: ids.length };
}
