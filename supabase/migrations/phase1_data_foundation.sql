-- ============================================================
-- Phase 1: Foundational data layer
-- - slot_control table (per canteen) with auto-derived capacity caps
-- - bins.status state machine (empty/preparing/placed/picked/late_pickup/grace_bin)
-- - menu_items extensions (availability_type, is_meal, is_hidden, is_sold_out, etc.)
-- - notifications.target_role for routing alerts
-- - RLS policies
-- Idempotent: safe to re-run.
-- ============================================================

-- ── 1. slot_control (one row per canteen) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.slot_control (
  canteen_id          uuid        PRIMARY KEY REFERENCES public.canteens(id) ON DELETE CASCADE,
  max_bins            int         NOT NULL DEFAULT 60 CHECK (max_bins > 0),
  slot_duration_mins  int         NOT NULL DEFAULT 15 CHECK (slot_duration_mins IN (10, 15, 20)),
  morning_start       time        NOT NULL DEFAULT '07:00',
  morning_end         time        NOT NULL DEFAULT '11:00',
  afternoon_start     time        NOT NULL DEFAULT '11:30',
  afternoon_end       time        NOT NULL DEFAULT '17:00',
  evening_start       time        NOT NULL DEFAULT '18:00',
  evening_end         time        NOT NULL DEFAULT '21:30',
  grace_period_mins   int         NOT NULL DEFAULT 10 CHECK (grace_period_mins >= 0),
  extra_bin_fee_paise int         NOT NULL DEFAULT 200 CHECK (extra_bin_fee_paise >= 0),
  meals_per_bin       int         NOT NULL DEFAULT 2 CHECK (meals_per_bin > 0),
  snacks_per_bin      int         NOT NULL DEFAULT 5 CHECK (snacks_per_bin > 0),
  -- Auto-derived caps:
  --   max_orders_per_slot = floor(max_bins * 0.75)
  --   batched_prepared_cap = floor(max_orders_per_slot * 0.70)
  --   made_to_order_cap = max_orders_per_slot - batched_prepared_cap
  max_orders_per_slot  int GENERATED ALWAYS AS (FLOOR(max_bins * 0.75)::int) STORED,
  batched_prepared_cap int GENERATED ALWAYS AS (FLOOR(FLOOR(max_bins * 0.75) * 0.70)::int) STORED,
  made_to_order_cap    int GENERATED ALWAYS AS (FLOOR(max_bins * 0.75)::int - FLOOR(FLOOR(max_bins * 0.75) * 0.70)::int) STORED,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_slot_control_updated_at ON public.slot_control;
CREATE TRIGGER trg_slot_control_updated_at
  BEFORE UPDATE ON public.slot_control
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed a row for every existing canteen
INSERT INTO public.slot_control (canteen_id)
SELECT id FROM public.canteens
ON CONFLICT (canteen_id) DO NOTHING;

-- ── 2. bins.status state machine ────────────────────────────────────────
ALTER TABLE public.bins
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'empty';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'bins' AND constraint_name = 'bins_status_check'
  ) THEN
    ALTER TABLE public.bins
      ADD CONSTRAINT bins_status_check
      CHECK (status IN ('empty','preparing','placed','picked','late_pickup','grace_bin'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bins_status ON public.bins(status);

-- Backfill status from is_occupied
UPDATE public.bins
   SET status = CASE WHEN is_occupied THEN 'placed' ELSE 'empty' END
 WHERE status = 'empty' AND is_occupied IS NOT NULL;

-- ── 3. menu_items extensions ────────────────────────────────────────────
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS availability_type text NOT NULL DEFAULT 'batched_prepared',
  ADD COLUMN IF NOT EXISTS quantity_per_slot int,
  ADD COLUMN IF NOT EXISTS total_per_day     int,
  ADD COLUMN IF NOT EXISTS is_meal           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_hidden         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_sold_out       boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'menu_items' AND constraint_name = 'menu_items_availability_type_check'
  ) THEN
    ALTER TABLE public.menu_items
      ADD CONSTRAINT menu_items_availability_type_check
      CHECK (availability_type IN ('slot_based','batched_prepared'));
  END IF;
END $$;

-- Backfill availability_type from production_type if present
UPDATE public.menu_items
   SET availability_type = CASE production_type::text
                             WHEN 'batched' THEN 'batched_prepared'
                             ELSE 'batched_prepared'
                           END
 WHERE availability_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_menu_items_is_hidden  ON public.menu_items(is_hidden);
CREATE INDEX IF NOT EXISTS idx_menu_items_is_sold_out ON public.menu_items(is_sold_out);

-- ── 4. notifications.target_role ────────────────────────────────────────
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS target_role text NOT NULL DEFAULT 'user';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'notifications' AND constraint_name = 'notifications_target_role_check'
  ) THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_target_role_check
      CHECK (target_role IN ('user','worker','canteen_admin','super_admin','all_staff'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_target_role ON public.notifications(target_role);

-- ── 5. RLS for slot_control ─────────────────────────────────────────────
ALTER TABLE public.slot_control ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "slot_control: service full" ON public.slot_control;
CREATE POLICY "slot_control: service full"
  ON public.slot_control FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "slot_control: read" ON public.slot_control;
CREATE POLICY "slot_control: read"
  ON public.slot_control FOR SELECT
  USING (
    canteen_id = get_my_canteen_id()
    OR get_my_role() IN ('super_admin')
  );

DROP POLICY IF EXISTS "slot_control: write" ON public.slot_control;
CREATE POLICY "slot_control: write"
  ON public.slot_control FOR UPDATE
  USING (
    (canteen_id = get_my_canteen_id() AND get_my_role() = 'canteen_admin')
    OR get_my_role() = 'super_admin'
  );

-- ── 6. Helper SQL: generate time slots for a canteen for a given window ─
CREATE OR REPLACE FUNCTION public.generate_time_slots(
  p_start time,
  p_end   time,
  p_duration_mins int
) RETURNS TABLE (slot_start time, slot_end time)
LANGUAGE sql IMMUTABLE
AS $$
  SELECT
    (p_start + (n * (p_duration_mins || ' minutes')::interval))::time            AS slot_start,
    (p_start + ((n + 1) * (p_duration_mins || ' minutes')::interval))::time      AS slot_end
  FROM generate_series(0, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (p_end - p_start)) / (p_duration_mins * 60))::int - 1)) AS n
$$;
