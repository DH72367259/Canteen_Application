import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Color zones for the physical bin rack — matches the PDF (page 10):
 * red, yellow, green, blue, purple, orange. Total bins are distributed
 * as evenly as possible across these zones.
 */
export const BIN_ZONES = ["red", "yellow", "green", "blue", "purple", "orange"] as const;
export type BinZone = (typeof BIN_ZONES)[number];

/** Format used by the PDF: `RED-1`, `GREEN-12`, etc. (matches existing `bins.bin_code`). */
export function binCode(zone: BinZone, n: number): string {
  return `${zone.toUpperCase()}-${n}`;
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

  const targetCodes: { bin_code: string; color: BinZone }[] = [];
  BIN_ZONES.forEach((zone, idx) => {
    const count = base + (idx < extra ? 1 : 0);
    for (let n = 1; n <= count; n++) {
      targetCodes.push({ bin_code: binCode(zone, n), color: zone });
    }
  });

  if (targetCodes.length === 0) return 0;

  // Find which already exist
  const { data: existing } = await supabase
    .from("bins")
    .select("bin_code")
    .eq("canteen_id", canteenId);
  const have = new Set((existing ?? []).map(r => String(r.bin_code)));

  const toInsert = targetCodes
    .filter(t => !have.has(t.bin_code))
    .map(t => ({ canteen_id: canteenId, bin_code: t.bin_code, color: t.color }));

  if (toInsert.length === 0) return 0;
  const { error } = await supabase.from("bins").insert(toInsert);
  if (error) {
    console.warn("[ensureBinsForCanteen] insert failed:", error.message);
    return 0;
  }
  return toInsert.length;
}
