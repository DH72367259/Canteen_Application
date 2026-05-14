/**
 * Slot-expiry bin release — two-step late pickup.
 *
 * When a slot's end time passes, any bin that is still occupied (food placed
 * but student hasn't collected) is moved to `late_pickup_pending`. The bin
 * is NOT freed yet — the worker must physically remove the order from the bin
 * and confirm via POST /api/orders/[id]/clear-bin before the bin is recycled.
 *
 * Full status machine:
 *   placed_in_bin → (slot ends)      → late_pickup_pending (bin still occupied)
 *                → (worker clears)   → late_pickup         (bin freed)
 *                → (student OTP)     → collected
 */

import type { SupabaseClient } from "@supabase/supabase-js";

function nowISTMinutes(): number {
  const now = new Date();
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

/**
 * Parse the END time from a slot label like "1:00 PM - 1:15 PM".
 * Returns minutes-since-midnight (IST) or null if not parseable.
 */
function parseSlotEndMinutes(slotLabel: string): number | null {
  const m = slotLabel.match(/[-–]\s*(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const isPm = m[3].toUpperCase() === "PM";
  if (isPm && h !== 12) h += 12;
  if (!isPm && h === 12) h = 0;
  return h * 60 + min;
}

export async function releaseExpiredSlotBins(
  supabase: SupabaseClient,
  canteenId: string,
): Promise<{ released: number }> {
  // Fetch all occupied bins for this canteen
  const { data: bins } = await supabase
    .from("bins")
    .select("id, bin_code, color, slot_label, order_id, assigned_order_id, current_order_id")
    .eq("canteen_id", canteenId)
    .eq("is_occupied", true);

  if (!bins?.length) return { released: 0 };

  const nowMin = nowISTMinutes();

  type BinRow = {
    id: string;
    bin_code: string | null;
    color: string | null;
    slot_label: string | null;
    order_id: string | null;
    assigned_order_id: string | null;
    current_order_id: string | null;
  };

  const toRelease: Array<{ binId: string; orderId: string }> = [];

  for (const bin of bins as BinRow[]) {
    const label = String(bin.slot_label ?? "");
    const endMin = parseSlotEndMinutes(label);
    // If we cannot parse the end time (e.g. synthetic test labels), skip.
    if (endMin === null) continue;
    if (nowMin < endMin) continue;

    const orderId = String(
      bin.current_order_id ?? bin.assigned_order_id ?? bin.order_id ?? ""
    );
    if (!orderId) continue;

    toRelease.push({ binId: bin.id, orderId });
  }

  if (!toRelease.length) return { released: 0 };

  const nowIso = new Date().toISOString();

  // Move orders to late_pickup_pending — bin stays occupied until worker confirms.
  // Do this one-at-a-time so a single bad row doesn't block the rest.
  for (const r of toRelease) {
    await supabase
      .from("orders")
      .update({ status: "late_pickup_pending", updated_at: nowIso })
      .eq("id", r.orderId)
      .in("status", [
        "placed", "confirmed", "preparing",
        "ready_for_placement", "placed_in_bin", "ready_for_pickup",
      ]);
  }

  // Mark bins as overdue (still occupied — worker must confirm physical removal)
  await supabase
    .from("bins")
    .update({ status: "late_pickup", updated_at: nowIso })
    .eq("canteen_id", canteenId)
    .in("id", toRelease.map(r => r.binId));

  return { released: toRelease.length };
}

/**
 * End-of-day auto-close.
 *
 * `late_pickup` orders from previous days → collected.
 * `late_pickup_pending` orders from previous days → bins freed + collected
 * (covers the case where a worker never clicked "Bin Cleared").
 */
export async function autoCloseEodLateOrders(
  supabase: SupabaseClient,
  canteenId: string,
): Promise<{ closed: number }> {
  // Compute midnight IST (start of today in IST, as UTC ISO string).
  const now = new Date();
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  const midnightIST = new Date(
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 0, 0, 0) -
    5.5 * 60 * 60 * 1000,
  );

  const midnightIso = midnightIST.toISOString();
  const nowIso = now.toISOString();

  // Close late_pickup orders (bins already freed)
  const { data: lateOrders } = await supabase
    .from("orders")
    .select("id")
    .eq("canteen_id", canteenId)
    .eq("status", "late_pickup")
    .lt("updated_at", midnightIso);

  if (lateOrders?.length) {
    await supabase
      .from("orders")
      .update({ status: "collected", updated_at: nowIso })
      .in("id", lateOrders.map((o: { id: string }) => o.id))
      .eq("status", "late_pickup");
  }

  // Close late_pickup_pending orders — also free their still-occupied bins
  const { data: pendingOrders } = await supabase
    .from("orders")
    .select("id, bin_id")
    .eq("canteen_id", canteenId)
    .eq("status", "late_pickup_pending")
    .lt("updated_at", midnightIso);

  if (pendingOrders?.length) {
    const pendingIds = pendingOrders.map((o: { id: string }) => o.id);
    const binIds = (pendingOrders as { id: string; bin_id: string | null }[])
      .map(o => o.bin_id)
      .filter((id): id is string => !!id);

    await supabase
      .from("orders")
      .update({ status: "collected", updated_at: nowIso })
      .in("id", pendingIds)
      .eq("status", "late_pickup_pending");

    if (binIds.length) {
      await supabase
        .from("bins")
        .update({
          is_occupied: false, order_id: null,
          assigned_order_id: null, status: "empty", updated_at: nowIso,
        })
        .in("id", binIds);
    }
  }

  return { closed: (lateOrders?.length ?? 0) + (pendingOrders?.length ?? 0) };
}
