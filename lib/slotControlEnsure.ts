import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureBinsForCanteen } from "./binProvisioning";

/**
 * slot_control row shape used across the API. Keep keys aligned with the
 * Postgres column names so callers can pass the result straight to clients.
 */
export interface SlotControlRow {
  canteen_id: string;
  max_bins: number;
  slot_duration_mins: number;
  grace_period_mins: number;
  morning_start: string;   morning_end: string;
  afternoon_start: string; afternoon_end: string;
  evening_start: string;   evening_end: string;
  extra_bin_fee_paise: number;
  meals_per_bin: number;
  snacks_per_bin: number;
  [key: string]: unknown;
}

const DEFAULTS = {
  max_bins: 60,
  slot_duration_mins: 15,
  grace_period_mins: 10,
  morning_start: "07:00",   morning_end: "11:00",
  afternoon_start: "11:30", afternoon_end: "17:00",
  evening_start: "18:00",   evening_end: "21:30",
  extra_bin_fee_paise: 0,
  meals_per_bin: 1,
  snacks_per_bin: 4,
} as const;

/**
 * Fetches the slot_control row for a canteen, lazily creating one with sane
 * defaults (and provisioning physical bins) if it doesn't exist yet. This
 * keeps older canteens (created before the Phase-1 migration backfill, or
 * pre-auto-provision deploys) from breaking the student checkout flow with
 * a 404 "slot_control not configured" error.
 */
export async function ensureSlotControl(
  supabase: SupabaseClient,
  canteenId: string,
): Promise<SlotControlRow | null> {
  if (!canteenId) return null;

  const existing = await supabase
    .from("slot_control")
    .select("*")
    .eq("canteen_id", canteenId)
    .maybeSingle();
  if (existing.data) return existing.data as SlotControlRow;
  if (existing.error && existing.error.code !== "PGRST116") {
    // PGRST116 = "row not found"; any other error is unexpected
    console.warn("[ensureSlotControl] lookup failed:", existing.error.message);
    return null;
  }

  const ins = await supabase
    .from("slot_control")
    .insert({ canteen_id: canteenId, ...DEFAULTS })
    .select("*")
    .single();
  if (ins.error || !ins.data) {
    console.warn("[ensureSlotControl] insert failed:", ins.error?.message);
    return null;
  }
  // Best-effort bin provisioning so the order flow can pick a real bin.
  await ensureBinsForCanteen(supabase, canteenId, DEFAULTS.max_bins);
  return ins.data as SlotControlRow;
}
