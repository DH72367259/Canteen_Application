/**
 * Slot-expiry bin release.
 *
 * When a slot's end time passes, any bin that is still occupied (food placed
 * but student hasn't collected) is transitioned to late_pickup:
 *
 *  1. The order's bin_label / bin_color are snapshotted from the physical bin
 *     so the historical bin assignment is preserved even after the bin is freed.
 *  2. The order status is updated to `late_pickup`.
 *  3. The order's bin_id is cleared (disconnects from the physical bin).
 *  4. The physical bin is freed (is_occupied=false) so it is available for the
 *     next slot's orders.
 *
 * Late pickup orders still appear in the worker and vendor dashboards, students
 * still need to present their OTP, and the full collected workflow applies —
 * the only change is that the physical bin is recycled.
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
  // Match the time after the dash/separator
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

  const toRelease: Array<{ binId: string; orderId: string; binCode: string; color: string }> = [];

  for (const bin of bins as BinRow[]) {
    const label = String(bin.slot_label ?? "");
    const endMin = parseSlotEndMinutes(label);
    // If we cannot parse the end time (e.g. synthetic test labels), skip —
    // those are handled by the existing 90-min stale-bin safety net.
    if (endMin === null) continue;
    if (nowMin < endMin) continue;

    const orderId = String(
      bin.current_order_id ?? bin.assigned_order_id ?? bin.order_id ?? ""
    );
    if (!orderId) continue;

    toRelease.push({
      binId:   bin.id,
      orderId,
      binCode: String(bin.bin_code ?? ""),
      color:   String(bin.color ?? ""),
    });
  }

  if (!toRelease.length) return { released: 0 };

  const nowIso = new Date().toISOString();

  // Snapshot bin details onto the order and mark it as late_pickup.
  // We do this one-at-a-time so a single bad row doesn't block the rest.
  for (const r of toRelease) {
    await supabase
      .from("orders")
      .update({
        status:    "late_pickup",
        bin_label: r.binCode,
        bin_color: r.color,
        bin_id:    null,
        updated_at: nowIso,
      })
      .eq("id", r.orderId)
      .in("status", [
        "placed", "confirmed", "preparing",
        "ready_for_placement", "placed_in_bin", "ready_for_pickup",
      ]);
  }

  // Free the physical bins in one batch
  await supabase
    .from("bins")
    .update({
      is_occupied:        false,
      order_id:           null,
      assigned_order_id:  null,
      slot_label:         null,
      status:             "empty",
      updated_at:         nowIso,
    })
    .eq("canteen_id", canteenId)
    .in("id", toRelease.map(r => r.binId));

  return { released: toRelease.length };
}

/**
 * End-of-day auto-close: any `late_pickup` order whose `updated_at` is before
 * midnight IST today (i.e. from a previous day) is marked `collected`.
 *
 * All stored details (bin_label, bin_color, items, OTP) are untouched, so the
 * order displays exactly like a normal collected order in every dashboard.
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

  const { data: expired } = await supabase
    .from("orders")
    .select("id")
    .eq("canteen_id", canteenId)
    .eq("status", "late_pickup")
    .lt("updated_at", midnightIST.toISOString());

  if (!expired?.length) return { closed: 0 };

  await supabase
    .from("orders")
    .update({ status: "collected", updated_at: new Date().toISOString() })
    .in("id", expired.map((o: { id: string }) => o.id))
    .eq("status", "late_pickup");

  return { closed: expired.length };
}
