-- ============================================================
-- Phase 8: Colour-coded rack workflow
--   * Adds zone_color + bin_number + assigned_order_id columns to bins
--     (the rack UI groups bins into 6 colour rows, ordered by bin_number).
--   * Backfills the new columns from the existing bin_code (`#RED001`).
--   * Expands bins.status check constraint to include the new lifecycle
--     values used by the worker progressive flow:
--         empty | reserved | occupied | late_pickup | disabled
--     Old values (preparing/placed/picked/grace_bin) continue to work and
--     are mapped on read by the application; we keep them in the constraint
--     so historical rows + in-flight orders never trip a CHECK violation.
--   * Adds a `regenerate_canteen_bins(canteen_id, max_bins)` SQL helper used
--     by the new POST /api/canteen/bins/regenerate endpoint.
-- Idempotent: safe to re-run.
-- ============================================================

-- 1. Add the new columns -----------------------------------------------------
ALTER TABLE public.bins
  ADD COLUMN IF NOT EXISTS zone_color        text,
  ADD COLUMN IF NOT EXISTS bin_number        int,
  ADD COLUMN IF NOT EXISTS assigned_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL;

-- 2. Backfill from existing bin_code / color --------------------------------
--    bin_code format is `#RED001` → zone_color='red', bin_number=1.
--    Older legacy rows may have `RED-1` style codes; handle both.
UPDATE public.bins
   SET zone_color = COALESCE(zone_color, LOWER(NULLIF(color, ''))),
       bin_number = COALESCE(bin_number,
                             NULLIF(regexp_replace(bin_code, '[^0-9]', '', 'g'), '')::int)
 WHERE zone_color IS NULL OR bin_number IS NULL;

-- If color column was empty, derive zone from the 3-letter abbrev in bin_code.
UPDATE public.bins
   SET zone_color = CASE UPPER(substring(bin_code FROM '[A-Za-z]{3}'))
                      WHEN 'RED' THEN 'red'
                      WHEN 'YEL' THEN 'yellow'
                      WHEN 'GRE' THEN 'green'
                      WHEN 'BLU' THEN 'blue'
                      WHEN 'PUR' THEN 'purple'
                      WHEN 'ORA' THEN 'orange'
                      ELSE zone_color END
 WHERE zone_color IS NULL OR zone_color = '';

CREATE INDEX IF NOT EXISTS idx_bins_zone_color ON public.bins(canteen_id, zone_color, bin_number);
CREATE INDEX IF NOT EXISTS idx_bins_assigned_order ON public.bins(assigned_order_id);

-- 3. Expand status check to include the new lifecycle values ----------------
ALTER TABLE public.bins DROP CONSTRAINT IF EXISTS bins_status_check;
ALTER TABLE public.bins
  ADD CONSTRAINT bins_status_check
  CHECK (status IN (
    -- Phase 1 lifecycle (kept for backward compat / in-flight orders)
    'empty','preparing','placed','picked','late_pickup','grace_bin',
    -- Phase 8 rack lifecycle (worker progressive flow)
    'reserved','occupied','disabled'
  ));

-- 4. regenerate_canteen_bins(canteen_id, max_bins) --------------------------
--    Wipes idle bins for a canteen and re-creates the colour rows so the
--    rack always reflects slot_control.max_bins. Bins currently linked to
--    an order are LEFT ALONE — operations stay safe even if a vendor edits
--    capacity mid-service.
CREATE OR REPLACE FUNCTION public.regenerate_canteen_bins(p_canteen uuid, p_max int)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  zones text[] := ARRAY['red','yellow','green','blue','purple','orange'];
  abbr  text;
  zone  text;
  base  int := p_max / 6;
  extra int := p_max % 6;
  count int;
  i     int;
  n     int;
  inserted int := 0;
BEGIN
  IF p_canteen IS NULL OR p_max IS NULL OR p_max <= 0 THEN
    RETURN 0;
  END IF;

  -- Drop idle bins that exceed the new cap so the rack shrinks correctly.
  DELETE FROM public.bins
   WHERE canteen_id = p_canteen
     AND assigned_order_id IS NULL
     AND is_occupied = false;

  FOR i IN 1..6 LOOP
    zone := zones[i];
    abbr := CASE zone
              WHEN 'red'    THEN 'RED'
              WHEN 'yellow' THEN 'YEL'
              WHEN 'green'  THEN 'GRE'
              WHEN 'blue'   THEN 'BLU'
              WHEN 'purple' THEN 'PUR'
              WHEN 'orange' THEN 'ORA'
            END;
    count := base + CASE WHEN i <= extra THEN 1 ELSE 0 END;
    FOR n IN 1..count LOOP
      INSERT INTO public.bins (canteen_id, bin_code, color, zone_color, bin_number, status)
      VALUES (p_canteen, '#' || abbr || lpad(n::text, 3, '0'),
              zone, zone, n, 'empty')
      ON CONFLICT (canteen_id, bin_code) DO NOTHING;
      IF FOUND THEN inserted := inserted + 1; END IF;
    END LOOP;
  END LOOP;

  RETURN inserted;
END;
$$;
