import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * All available color zones for the physical bin rack (from PDF).
 * Each zone holds exactly 12 bins. Only the zones needed for max_bins are created.
 */
export const ALL_BIN_ZONES = ["red", "yellow", "green", "blue", "purple", "orange"] as const;
export type BinZone = (typeof ALL_BIN_ZONES)[number];

/** Bins per zone (FIXED at 12) */
export const BINS_PER_ZONE = 12;

/** 3-letter zone abbreviation used in the canonical bin code prefix. */
export const ZONE_ABBR: Record<BinZone, string> = {
  red: "RED", yellow: "YEL", green: "GRE",
  blue: "BLU", purple: "PUR", orange: "ORA",
};

/**
 * Canonical bin_code format per the revised workflow PDF:
 *   `#RED001` through `#RED012` (red zone has bins 1-12)
 *   `#YEL001` through `#YEL012` (yellow zone has bins 1-12, if needed)
 *   etc.
 * Format: `#` + 3-letter zone abbrev + 3-digit zero-padded number (1-12)
 */
export function binCode(zone: BinZone, n: number): string {
  return `#${ZONE_ABBR[zone]}${String(n).padStart(3, "0")}`;
}

/**
 * Calculate how many bins each color zone gets for a given total.
 * Always uses all 6 zones. Bins are distributed as evenly as possible;
 * the first (total % 6) zones get one extra bin. Max per zone is 12.
 *
 * Examples:
 *   total=72 → 6 zones, 12 each        (72 / 6 = 12, remainder 0)
 *   total=60 → 6 zones, 10 each        (60 / 6 = 10, remainder 0)
 *   total=50 → 6 zones, first 2 get 9, rest get 8  (50 / 6 = 8 r 2)
 *   total=12 → 6 zones, first 0 get 3, rest... base=2, first 0 get 3
 */
export function binsPerZone(total: number): number[] {
  const capped = Math.min(total, ALL_BIN_ZONES.length * BINS_PER_ZONE);
  const base  = Math.floor(capped / ALL_BIN_ZONES.length);
  const extra = capped % ALL_BIN_ZONES.length;
  return ALL_BIN_ZONES.map((_, i) => base + (i < extra ? 1 : 0));
}

/**
 * All 6 zones are always active regardless of total.
 */
export function getActiveZones(_total: number): BinZone[] {
  return ALL_BIN_ZONES.slice();
}

/**
 * Idempotently provision physical bins for a canteen.
 * - Always uses all 6 color zones
 * - Bins are distributed evenly across zones (max 12 per zone)
 * - Inserts only the bins that don't already exist (UNIQUE on canteen_id+bin_code)
 *
 * Examples:
 *   total=72: 6 zones × 12 each
 *   total=60: 6 zones × 10 each
 *   total=50: red 9, yellow 9, green 8, blue 8, purple 8, orange 8
 *
 * Returns the number of newly inserted bins.
 */
export async function ensureBinsForCanteen(
  supabase: SupabaseClient,
  canteenId: string,
  total: number,
): Promise<number> {
  if (!canteenId || !Number.isFinite(total) || total <= 0) return 0;

  const zoneSizes = binsPerZone(total);
  const targetCodes: { bin_code: string; color: BinZone; bin_number: number }[] = [];

  ALL_BIN_ZONES.forEach((zone, zoneIdx) => {
    for (let n = 1; n <= zoneSizes[zoneIdx]; n++) {
      targetCodes.push({ bin_code: binCode(zone, n), color: zone, bin_number: n });
    }
  });

  if (targetCodes.length === 0) return 0;

  // Find which already exist (by canonical bin_code).
  const { data: existing } = await supabase
    .from("bins")
    .select("bin_code")
    .eq("canteen_id", canteenId);
  const have = new Set((existing ?? []).map(r => String(r.bin_code)));

  // Migration helper: if a bin exists in the legacy "RED-1" format, rename it
  // to "#RED001" in-place so the new format becomes canonical without losing
  // any state (orders, occupancy, etc).
  for (const t of targetCodes) {
    const legacy = `${ZONE_ABBR[t.color]}-${t.bin_number}`;          // e.g. RED-1
    const legacyFull = `${t.color.toUpperCase()}-${t.bin_number}`;   // e.g. RED-1 (same here)
    if (!have.has(t.bin_code) && (have.has(legacy) || have.has(legacyFull))) {
      await supabase.from("bins")
        .update({ bin_code: t.bin_code })
        .eq("canteen_id", canteenId)
        .in("bin_code", [legacy, legacyFull]);
      have.add(t.bin_code);
    }
  }

  const toInsert = targetCodes
    .filter(t => !have.has(t.bin_code))
    .map(t => ({
      canteen_id: canteenId,
      bin_code:   t.bin_code,
      color:      t.color,
      zone_color: t.color,
      bin_number: t.bin_number,
      status:     "empty",
    }));

  if (toInsert.length === 0) return 0;
  const { error } = await supabase.from("bins").insert(toInsert);
  if (error) {
    console.warn("[ensureBinsForCanteen] insert failed:", error.message);
    return 0;
  }
  return toInsert.length;
}

/**
 * Reconcile the physical bin rack so it exactly matches `total`.
 *
 * - Deletes idle bins (is_occupied=false, assigned_order_id IS NULL) whose
 *   bin_code falls outside the target set (i.e. excess bins from a prior
 *   higher max_bins).
 * - Inserts any target bins that are missing.
 *
 * Bins that are currently occupied or linked to an order are NEVER deleted —
 * they will remain until they are naturally freed; the Bin Management UI
 * will show the correct count once those orders are collected.
 *
 * Returns { deleted, inserted }.
 */
export async function reconcileBinsForCanteen(
  supabase: SupabaseClient,
  canteenId: string,
  total: number,
): Promise<{ deleted: number; inserted: number }> {
  if (!canteenId || !Number.isFinite(total) || total <= 0) return { deleted: 0, inserted: 0 };

  const zoneSizes = binsPerZone(total);
  const targetSet = new Set<string>();
  ALL_BIN_ZONES.forEach((zone, zoneIdx) => {
    for (let n = 1; n <= zoneSizes[zoneIdx]; n++) {
      targetSet.add(binCode(zone, n));
    }
  });

  // Fetch all idle bins for this canteen.
  const { data: idleBins } = await supabase
    .from("bins")
    .select("bin_code")
    .eq("canteen_id", canteenId)
    .eq("is_occupied", false)
    .is("assigned_order_id", null);

  const surplusCodes = (idleBins ?? [])
    .map(r => String(r.bin_code))
    .filter(code => !targetSet.has(code));

  let deleted = 0;
  if (surplusCodes.length > 0) {
    const { error } = await supabase
      .from("bins")
      .delete()
      .eq("canteen_id", canteenId)
      .in("bin_code", surplusCodes);
    if (error) {
      console.warn("[reconcileBinsForCanteen] delete failed:", error.message);
    } else {
      deleted = surplusCodes.length;
    }
  }

  const inserted = await ensureBinsForCanteen(supabase, canteenId, total);
  return { deleted, inserted };
}
