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
 * Calculate how many color zones are needed for a given number of bins.
 * Each zone holds exactly 12 bins.
 * Examples:
 *   total=12 → 1 zone (red only)
 *   total=24 → 2 zones (red, yellow)
 *   total=50 → 5 zones (red, yellow, green, blue, purple: 12+12+12+12+2)
 *   total=60 → 5 zones (red through purple, all 12 each)
 */
export function zonesNeeded(total: number): number {
  return Math.ceil(total / BINS_PER_ZONE);
}

/**
 * Get active color zones for a given bin capacity.
 * Only returns the zones needed.
 */
export function getActiveZones(total: number): BinZone[] {
  const count = zonesNeeded(total);
  return ALL_BIN_ZONES.slice(0, count);
}

/**
 * Idempotently provision physical bins for a canteen.
 * - Each color zone holds exactly 12 bins
 * - Only creates as many zones as needed for the capacity
 * - Inserts only the bins that don't already exist (UNIQUE on canteen_id+bin_code)
 *
 * Examples:
 *   total=12:  1 zone  (red 1-12)
 *   total=24:  2 zones (red 1-12, yellow 1-12)
 *   total=50:  5 zones (red 1-12, yellow 1-12, green 1-12, blue 1-12, purple 1-2)
 *
 * Returns the number of newly inserted bins.
 */
export async function ensureBinsForCanteen(
  supabase: SupabaseClient,
  canteenId: string,
  total: number,
): Promise<number> {
  if (!canteenId || !Number.isFinite(total) || total <= 0) return 0;

  const activeZones = getActiveZones(total);
  const targetCodes: { bin_code: string; color: BinZone; bin_number: number }[] = [];

  // For each active zone, add bins 1-12 (or partial for last zone)
  activeZones.forEach((zone, zoneIdx) => {
    const isLastZone = zoneIdx === activeZones.length - 1;
    const binsInThisZone = isLastZone
      ? (total % BINS_PER_ZONE) || BINS_PER_ZONE  // Remainder or 12 if exact
      : BINS_PER_ZONE;

    for (let n = 1; n <= binsInThisZone; n++) {
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

