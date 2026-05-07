-- ============================================================
-- Phase 12: Add slot_label to bins table
--
-- bins.slot_label records which time slot currently holds this bin.
-- Set when a bin is claimed (atomicBinClaim), cleared when released.
-- Without this column every bin claim and bin release silently fails
-- because PostgREST rejects UPDATEs that reference unknown columns.
-- Idempotent: safe to re-run.
-- ============================================================

ALTER TABLE public.bins
  ADD COLUMN IF NOT EXISTS slot_label text;

CREATE INDEX IF NOT EXISTS idx_bins_slot_label
  ON public.bins(canteen_id, slot_label)
  WHERE slot_label IS NOT NULL;
