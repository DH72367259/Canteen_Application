/**
 * Slot-expiry bin release — two-step late pickup.
 *
 * When a slot's end time passes, any active order whose slot has expired is
 * transitioned based on whether it was physically placed in a bin:
 *
 *   placed_in_bin / ready_for_pickup
 *       → late_pickup_pending  (bin still occupied; worker must clear)
 *       → (worker clears bin) → late_pickup  (bin freed, food at counter)
 *       → (student OTP)       → collected
 *
 *   confirmed / preparing / placed / ready_for_placement  (never reached bin)
 *       → late_pickup  (skip directly; no bin to clear)
 *
 * Source of truth: orders.slot_label + orders.status — avoids bins table
 * schema drift (current_order_id may not exist in all production schemas).
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
 * Handles both 12-hour format "9:00 AM - 9:15 AM" and
 * 24-hour format "09:00 - 09:15".
 * Returns minutes-since-midnight (IST) or null if not parseable.
 */
function parseSlotEndMinutes(slotLabel: string): number | null {
  // Try 12-hour AM/PM format first: "... - 9:15 PM"
  const m12 = slotLabel.match(/[-–]\s*(\d+):(\d+)\s*(AM|PM)/i);
  if (m12) {
    let h = parseInt(m12[1], 10);
    const min = parseInt(m12[2], 10);
    const isPm = m12[3].toUpperCase() === "PM";
    if (isPm && h !== 12) h += 12;
    if (!isPm && h === 12) h = 0;
    return h * 60 + min;
  }

  // Try 24-hour format: "09:00 - 09:15" or "09:00–09:15"
  const m24 = slotLabel.match(/[-–]\s*(\d{1,2}):(\d{2})\s*$/);
  if (m24) {
    const h = parseInt(m24[1], 10);
    const min = parseInt(m24[2], 10);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      return h * 60 + min;
    }
  }

  return null;
}

type ActiveOrder = {
  id: string;
  status: string;
  slot_label: string | null;
  bin_id: string | null;
};

export async function releaseExpiredSlotBins(
  supabase: SupabaseClient,
  canteenId: string,
): Promise<{ released: number }> {
  // Query active orders directly — avoids bins.current_order_id column drift
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
  let released = 0;

  for (const raw of activeOrders) {
    const order = raw as unknown as ActiveOrder;
    const label = String(order.slot_label ?? "");
    const endMin = parseSlotEndMinutes(label);
    if (endMin === null) continue;  // synthetic / unparseable label → skip
    if (nowMin < endMin) continue;  // slot hasn't ended yet → skip

    if (order.status === "placed_in_bin" || order.status === "ready_for_pickup") {
      // Food is physically in a bin — worker must clear it first
      const { error: ue } = await supabase
        .from("orders")
        .update({ status: "late_pickup_pending", updated_at: nowIso })
        .eq("id", order.id)
        .in("status", ["placed_in_bin", "ready_for_pickup"]);

      if (!ue && order.bin_id) {
        // Mark bin as overdue — stays occupied until worker confirms removal
        await supabase
          .from("bins")
          .update({ status: "late_pickup", updated_at: nowIso })
          .eq("id", order.bin_id);
      }
    } else {
      // Never reached a physical bin → skip directly to late_pickup
      const { error: ue } = await supabase
        .from("orders")
        .update({ status: "late_pickup", updated_at: nowIso })
        .eq("id", order.id)
        .in("status", ["placed", "confirmed", "preparing", "ready_for_placement"]);

      // Free any reserved bin (shouldn't be occupied, but clean up just in case)
      if (!ue && order.bin_id) {
        await supabase
          .from("bins")
          .update({
            is_occupied: false,
            order_id: null,
            assigned_order_id: null,
            status: "empty",
            updated_at: nowIso,
          })
          .eq("id", order.bin_id);
      }
    }

    released++;
  }

  return { released };
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
