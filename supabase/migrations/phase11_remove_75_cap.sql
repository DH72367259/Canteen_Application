-- ============================================================
-- PHASE 11: Remove 75/25 Slot Capacity Split
-- All bins are now available for each slot (100% capacity)
-- ============================================================

-- Drop and recreate the generated columns to change the formula
ALTER TABLE public.slot_control
  DROP COLUMN IF EXISTS max_orders_per_slot,
  DROP COLUMN IF EXISTS batched_prepared_cap,
  DROP COLUMN IF EXISTS made_to_order_cap;

-- Recreate with new formula: 100% of bins available per slot
-- Keep batched_prepared_cap and made_to_order_cap for kitchen planning (60/40 split)
ALTER TABLE public.slot_control
  ADD COLUMN max_orders_per_slot int GENERATED ALWAYS AS (max_bins) STORED,
  ADD COLUMN batched_prepared_cap int GENERATED ALWAYS AS (FLOOR(max_bins * 0.60)::int) STORED,
  ADD COLUMN made_to_order_cap int GENERATED ALWAYS AS (max_bins - FLOOR(max_bins * 0.60)::int) STORED;

-- Verify the change
SELECT
  canteen_id,
  max_bins,
  max_orders_per_slot,
  batched_prepared_cap,
  made_to_order_cap
FROM public.slot_control
LIMIT 1;
