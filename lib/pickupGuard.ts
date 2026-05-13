import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-customer "all-or-nothing" pickup guard — scoped to the SAME slot.
 *
 * If a student has multiple orders for the same slot (e.g. placed two orders
 * for the 1:00 PM window), staff may only verify an OTP once every sibling
 * order in that slot has physically reached its bin, so the student picks up
 * everything in one trip.
 *
 * Orders in different slots are INDEPENDENT — a 1:00 PM order can be
 * completed even if the same student's 1:15 PM order hasn't reached its bin.
 *
 * Returns null if the order is clear to be collected, or a reason payload
 * (siblings still in prep + suggested HTTP status) when blocked.
 */
export type SiblingBlock = {
  status: number;
  message: string;
  siblings: Array<{ id: string; status: string; binLabel: string | null }>;
};

const PHYSICAL_DONE = ["placed_in_bin", "ready_for_pickup", "collected", "cancelled", "completed"];

export async function findUnfulfilledSiblings(
  supabase: SupabaseClient,
  order: {
    id: string;
    user_id: string | null;
    canteen_id: string | null;
    slot_id?: string | null;
    slot_label?: string | null;
  },
): Promise<SiblingBlock | null> {
  if (!order.user_id || !order.canteen_id) return null;

  // Base query: same student, same canteen, different order
  let query = supabase
    .from("orders")
    .select("id, status, bin_label, slot_id, slot_label")
    .eq("user_id", order.user_id)
    .eq("canteen_id", order.canteen_id)
    .neq("id", order.id);

  // Scope to the same slot so different-slot orders don't block each other.
  // Prefer slot_id (stable UUID) over slot_label (display string).
  if (order.slot_id) {
    query = query.eq("slot_id", order.slot_id);
  } else if (order.slot_label) {
    query = query.eq("slot_label", order.slot_label);
  } else {
    // No slot info — skip guard entirely so we never block across different slots.
    return null;
  }

  const { data: siblings } = await query;

  const stillPrep = (siblings ?? []).filter(
    (s: { status: string }) => !PHYSICAL_DONE.includes(s.status),
  );
  if (stillPrep.length === 0) return null;

  const labels = stillPrep
    .map((s: { bin_label: string | null }) => s.bin_label)
    .filter((l): l is string => !!l);
  const labelHint = labels.length ? ` (${labels.join(", ")})` : "";
  return {
    status: 409,
    message: `Customer has ${stillPrep.length} other order${stillPrep.length === 1 ? "" : "s"} in this slot still being prepared${labelHint}. Hand over everything together — verify OTP once all bins for this slot are placed.`,
    siblings: stillPrep.map((s: { id: string; status: string; bin_label: string | null }) => ({
      id: s.id, status: s.status, binLabel: s.bin_label,
    })),
  };
}
