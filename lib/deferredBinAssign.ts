/**
 * Deferred bin assignment — bins are NOT claimed at order placement.
 * Instead, this function is called on every vendor poll (live-orders,
 * /api/orders GET) and batch-assigns physical bins to orders whose
 * slot start time has arrived. The same 60 physical bins then recycle
 * across every 15-minute slot throughout the day.
 *
 * Late-pickup bins stay occupied until the student collects. If late
 * pickups exhaust the free pool, orders for the next slot wait until
 * at least one bin is freed — the vendor can use Release All to unblock.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

function nowISTMinutes(): number {
  const now = new Date();
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

// Parse slot label like "9:15 PM - 9:30 PM" → slot start in minutes (1275)
function parseSlotStartMinutes(slotLabel: string): number | null {
  const m = slotLabel.trim().match(/^(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const isPm = m[3].toUpperCase() === "PM";
  if (isPm && h !== 12) h += 12;
  if (!isPm && h === 12) h = 0;
  return h * 60 + min;
}

export async function assignDeferredBins(
  supabase: SupabaseClient,
  canteenId: string
): Promise<{ assigned: number }> {
  const nowMin = nowISTMinutes();

  // Find active orders for this canteen that still have no physical bin
  const { data: unassigned } = await supabase
    .from("orders")
    .select("id, slot_label, bin_count, status")
    .eq("canteen_id", canteenId)
    .is("bin_id", null)
    .in("status", ["placed", "confirmed", "preparing"])
    .not("slot_label", "is", null)
    .order("created_at", { ascending: true });

  if (!unassigned?.length) return { assigned: 0 };

  // Only assign bins for slots whose start time has passed
  const readyOrders = unassigned.filter((o) => {
    const startMin = parseSlotStartMinutes(String(o.slot_label ?? ""));
    return startMin !== null && nowMin >= startMin;
  });

  if (!readyOrders.length) return { assigned: 0 };

  const totalNeeded = readyOrders.reduce((sum, o) => sum + (Number(o.bin_count) || 1), 0);

  // Fetch available bins once, pick sequentially per order
  const { data: freeBins } = await supabase
    .from("bins")
    .select("id, bin_code, color")
    .eq("canteen_id", canteenId)
    .eq("is_occupied", false)
    .eq("status", "empty")
    .order("bin_code", { ascending: true })
    .limit(totalNeeded + 10);

  type FreeBin = { id: string; bin_code: string; color: string | null };
  let pool = (freeBins ?? []) as FreeBin[];
  let assigned = 0;
  const now = new Date().toISOString();

  for (const order of readyOrders) {
    const needed = Number(order.bin_count) || 1;
    if (pool.length < needed) break;

    const pick = pool.slice(0, needed);
    pool = pool.slice(needed);
    const firstBin = pick[0];
    const slotLabel = String(order.slot_label ?? "");
    const pickIds = pick.map((b) => b.id);

    // Atomic claim: UPDATE WHERE is_occupied=false prevents races
    const { data: claimed } = await supabase
      .from("bins")
      .update({
        is_occupied: true,
        order_id: order.id,
        assigned_order_id: order.id,
        status: "reserved",
        slot_label: slotLabel,
        updated_at: now,
      })
      .eq("canteen_id", canteenId)
      .eq("is_occupied", false)
      .in("id", pickIds)
      .select("id");

    const claimedCount = (claimed ?? []).length;
    if (claimedCount < needed) {
      // Race condition — rollback any partial claims
      if (claimedCount > 0) {
        const ids = (claimed as { id: string }[]).map((r) => r.id);
        await supabase
          .from("bins")
          .update({ is_occupied: false, order_id: null, assigned_order_id: null, status: "empty", updated_at: now })
          .in("id", ids);
      }
      continue;
    }

    // Stamp the order with its bin
    const { error: orderErr } = await supabase
      .from("orders")
      .update({
        bin_id: firstBin.id,
        bin_label: firstBin.bin_code,
        bin_color: firstBin.color ?? "blue",
      })
      .eq("id", order.id)
      .is("bin_id", null); // guard: skip if already assigned by a concurrent poll

    if (orderErr) {
      // Rollback bin claims
      await supabase
        .from("bins")
        .update({ is_occupied: false, order_id: null, assigned_order_id: null, status: "empty", updated_at: now })
        .in("id", pickIds);
      continue;
    }

    assigned++;
  }

  return { assigned };
}
