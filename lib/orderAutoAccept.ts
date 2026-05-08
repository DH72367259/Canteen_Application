import type { SupabaseClient } from "@supabase/supabase-js";

export interface AutoAcceptOptions {
  supabase: SupabaseClient;
  canteenId?: string;
  userId?: string;
}

function nowISTMinutes(): number {
  const now = new Date();
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

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

/**
 * Auto-promotes `placed` orders to `confirmed` when their slot start time
 * has arrived in IST. Orders with no recognisable slot_label fall back to a
 * 35-second age guard so E2E tests using synthetic labels still get accepted.
 */
export async function autoAcceptPlacedOrders(options: AutoAcceptOptions): Promise<{ updatedCount: number }> {
  const { supabase, canteenId, userId } = options;

  let q = supabase
    .from("orders")
    .select("id, slot_label, created_at")
    .eq("status", "placed");

  if (canteenId) q = q.eq("canteen_id", canteenId);
  if (userId)    q = q.eq("user_id", userId);

  const { data: orders } = await q;
  if (!orders?.length) return { updatedCount: 0 };

  const nowMin = nowISTMinutes();
  const nowMs  = Date.now();
  const toAccept: string[] = [];

  for (const order of orders) {
    const label = String(order.slot_label ?? "");
    const startMin = parseSlotStartMinutes(label);
    if (startMin !== null) {
      // Real slot label — accept when slot start time has passed
      if (nowMin >= startMin) toAccept.push(order.id);
    } else {
      // Synthetic / no slot label — fall back to 35-second age guard
      const ageMs = nowMs - new Date(String(order.created_at)).getTime();
      if (ageMs >= 35_000) toAccept.push(order.id);
    }
  }

  if (!toAccept.length) return { updatedCount: 0 };

  const { data } = await supabase
    .from("orders")
    .update({ status: "confirmed", updated_at: new Date().toISOString() })
    .in("id", toAccept)
    .eq("status", "placed")
    .select("id");

  return { updatedCount: (data ?? []).length };
}
