import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Color zones for the physical bin rack — matches the PDF (page 10):
 * red, yellow, green, blue, purple, orange. Total bins are distributed
 * as evenly as possible across these zones.
 */
export const BIN_ZONES = ["red", "yellow", "green", "blue", "purple", "orange"] as const;
export type BinZone = (typeof BIN_ZONES)[number];

/** 3-letter zone abbreviation used in the canonical bin code prefix. */
export const ZONE_ABBR: Record<BinZone, string> = {
  red: "RED", yellow: "YEL", green: "GRE",
  blue: "BLU", purple: "PUR", orange: "ORA",
};

/**
 * Canonical bin_code format per the revised workflow PDF (page 10):
 *   `#RED001`, `#YEL012`, `#GRE004`, etc. — `#` + 3-letter zone abbrev +
 *   3-digit zero-padded number. We use this everywhere a bin is shown to
 *   the user, worker, or vendor so "Bin 4" never collides across zones.
 */
export function binCode(zone: BinZone, n: number): string {
  return `#${ZONE_ABBR[zone]}${String(n).padStart(3, "0")}`;
}

/**
 * Idempotently provision physical bins for a canteen.
 * - Splits `total` across the six color zones as evenly as possible.
 * - Inserts only the bins that don't already exist (UNIQUE on canteen_id+bin_code),
 *   so this is safe to call repeatedly when the vendor changes max_bins.
 *
 * Returns the number of newly inserted bins.
 */
export async function ensureBinsForCanteen(
  supabase: SupabaseClient,
  canteenId: string,
  total: number,
): Promise<number> {
  if (!canteenId || !Number.isFinite(total) || total <= 0) return 0;
  const zones = BIN_ZONES.length;
  const base = Math.floor(total / zones);
  const extra = total % zones;

  const targetCodes: { bin_code: string; color: BinZone; bin_number: number }[] = [];
  BIN_ZONES.forEach((zone, idx) => {
    const count = base + (idx < extra ? 1 : 0);
    for (let n = 1; n <= count; n++) {
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

