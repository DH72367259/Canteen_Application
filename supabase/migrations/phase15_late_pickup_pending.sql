-- ============================================================
-- Phase 15: Two-step late pickup — worker must confirm bin cleared
--
-- Adds `late_pickup_pending` order status so that when a slot expires the
-- physical bin is NOT freed immediately. Instead:
--   placed_in_bin → (slot ends) → late_pickup_pending   (bin still occupied)
--                → (worker clears bin) → late_pickup    (bin freed)
--                → (student OTP)       → collected
--
-- Also adds `bin_label` and `bin_color` columns to orders (snapshotted from
-- the physical bin at the moment the worker clears it so the order retains
-- its bin reference after the bin is recycled).
-- Idempotent: safe to re-run.
-- ============================================================

-- 1. Add late_pickup and late_pickup_pending values to the order_status ENUM
--    (ALTER TYPE ADD VALUE cannot run inside a transaction; use a DO block
--    to make it safe and idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
    BEGIN
      ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'late_pickup';
    EXCEPTION WHEN others THEN NULL;
    END;
    BEGIN
      ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'late_pickup_pending';
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
END $$;

-- 2. Add bin_label and bin_color snapshot columns to orders (if missing)
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS bin_label text,
  ADD COLUMN IF NOT EXISTS bin_color text;
