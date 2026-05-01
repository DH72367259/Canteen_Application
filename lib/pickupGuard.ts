import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-customer "all-or-nothing" pickup guard.
 *
 * If a single student has multiple orders at the same canteen (e.g. they
 * placed 2 orders back-to-back), staff (manager OR worker) may only verify
 * an OTP once EVERY one of that customer's sibling orders has reached the
 * physical bin. Otherwise the customer would walk up, get one half of their
 * food handed over, and have to come back later for the rest.
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
  order: { id: string; user_id: string | null; canteen_id: string | null },
): Promise<SiblingBlock | null> {
  if (!order.user_id || !order.canteen_id) return null;

  const { data: siblings } = await supabase
    .from("orders")
    .select("id, status, bin_label")
    .eq("user_id", order.user_id)
    .eq("canteen_id", order.canteen_id)
    .neq("id", order.id);

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
    message: `Customer has ${stillPrep.length} other order${stillPrep.length === 1 ? "" : "s"} still being prepared${labelHint}. Hand over everything together — verify OTP only once all bins are placed.`,
    siblings: stillPrep.map((s: { id: string; status: string; bin_label: string | null }) => ({
      id: s.id, status: s.status, binLabel: s.bin_label,
    })),
  };
}
