/**
 * Atomic bin claiming to prevent race conditions where two concurrent orders
 * could claim the same bin. Uses a single UPDATE statement with WHERE clause
 * to ensure only free bins are claimed.
 */

import { createAdminClient } from "@/lib/supabase-server";

export interface BinClaimResult {
  success: boolean;
  claimedIds: string[];
  message?: string;
}

/**
 * Atomically claim N free bins for an order.
 * Returns the exact bins claimed, or an error if not enough bins are available.
 * 
 * - Uses UPDATE ... WHERE is_occupied=false to ensure atomicity
 * - Re-queries to verify claimed bins actually exist
 * - Fails if not enough bins can be claimed (race condition = another order got them)
 */
export async function claimFreeBinsAtomic(
  canteenId: string,
  binIdsToAttempt: string[],
  orderId: string,
  requiredCount: number,
  slotLabel?: string  // ✅ ADD SLOT FILTERING
): Promise<BinClaimResult> {
  if (binIdsToAttempt.length < requiredCount) {
    return {
      success: false,
      claimedIds: [],
      message: `Not enough free bins available: need ${requiredCount}, found ${binIdsToAttempt.length}`,
    };
  }

  const supabase = createAdminClient();

  // Step 1: Atomically claim these N bins in a single UPDATE
  // Only bins that are still free (is_occupied=false) will be updated
  // ✅ CRITICAL FIX: Filter by slot_label to prevent orders from different slots
  // stealing bins from each other
  const idsToAttempt = binIdsToAttempt.slice(0, requiredCount);
  let query = supabase
    .from("bins")
    .update({
      is_occupied: true,
      order_id: orderId,
      assigned_order_id: orderId,
      status: "reserved",
      updated_at: new Date().toISOString(),
    })
    .eq("canteen_id", canteenId)
    .eq("is_occupied", false);  // Only free bins

  // ✅ Add slot filter if provided - ensures slot A bins != slot B bins
  if (slotLabel) {
    query = query.eq("slot_label", slotLabel);
  }

  const { error: updateError, data: updateData } = await query
    .in("id", idsToAttempt)
    .select("id");

  if (updateError) {
    return {
      success: false,
      claimedIds: [],
      message: `Database error claiming bins: ${updateError.message}`,
    };
  }

  // Step 2: Verify that we actually claimed the required number
  // If another concurrent request claimed them first, updateData.length < requiredCount
  const updated = (updateData ?? []) as Array<{ id: string }>;
  const claimedIds = updated.map((r) => r.id);

  if (claimedIds.length < requiredCount) {
    // Race condition: not all bins we attempted were free
    // Rollback by releasing any bins we did claim (release back to free)
    if (claimedIds.length > 0) {
      await supabase
        .from("bins")
        .update({
          is_occupied: false,
          order_id: null,
          assigned_order_id: null,
          status: "available",
          updated_at: new Date().toISOString(),
        })
        .in("id", claimedIds);
    }
    return {
      success: false,
      claimedIds: [],
      message: `Race condition: only ${claimedIds.length}/${requiredCount} bins available. Try again.`,
    };
  }

  return {
    success: true,
    claimedIds,
  };
}
