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
-- Idempotent: safe to re-run on both staging and production.
-- ============================================================

-- 1a. If orders.status is an ENUM type, add values the safe way
--     (ALTER TYPE ADD VALUE cannot run inside a transaction block)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
    -- Cannot use ALTER TYPE ADD VALUE inside a subtransaction (BEGIN...EXCEPTION
    -- creates a savepoint). Run each value via its own DO block instead.
    PERFORM pg_catalog.set_config('search_path', 'public', false);
    EXECUTE $sql$
      DO $inner$
      BEGIN
        ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'late_pickup';
      EXCEPTION WHEN OTHERS THEN NULL;
      END $inner$;
    $sql$;
    EXECUTE $sql$
      DO $inner$
      BEGIN
        ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'late_pickup_pending';
      EXCEPTION WHEN OTHERS THEN NULL;
      END $inner$;
    $sql$;
  END IF;
END $$;

-- 1b. If orders.status is a TEXT column protected by a CHECK constraint,
--     rebuild the constraint to include the two new values. This is the
--     typical Supabase-hosted project setup where native enums are not used.
DO $$
DECLARE
  v_constraint text;
  v_new_check  text;
BEGIN
  -- Find the CHECK constraint on orders.status (name may vary across deployments)
  SELECT conname INTO v_constraint
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'orders'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%status%'
    AND pg_get_constraintdef(c.oid) LIKE '%placed%'
  LIMIT 1;

  IF v_constraint IS NOT NULL THEN
    -- Drop the old constraint and recreate with ALL status values including the new ones.
    EXECUTE format('ALTER TABLE public.orders DROP CONSTRAINT %I', v_constraint);

    v_new_check := $check$(status = ANY (ARRAY[
      'placed','confirmed','preparing','ready_for_placement',
      'placed_in_bin','ready_for_pickup','collected','cancelled',
      'late_pickup','late_pickup_pending',
      'received','ready','completed','grace_bin'
    ]::text[]))$check$;

    EXECUTE format(
      'ALTER TABLE public.orders ADD CONSTRAINT %I CHECK %s',
      v_constraint,
      v_new_check
    );

    RAISE NOTICE 'Rebuilt % to include late_pickup and late_pickup_pending', v_constraint;
  END IF;
END $$;

-- 2. Snapshot columns — safe to add even if they already exist
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS bin_label text,
  ADD COLUMN IF NOT EXISTS bin_color text;
