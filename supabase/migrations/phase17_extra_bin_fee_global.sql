-- Phase 17: Move extra_bin_fee_paise from per-canteen slot_control
-- to the global platform_charges table.
-- Extra bin revenue goes to the platform, so a single global rate makes sense.

ALTER TABLE public.platform_charges
  ADD COLUMN IF NOT EXISTS extra_bin_fee_paise integer NOT NULL DEFAULT 200;

-- Seed the default row if it doesn't exist yet
INSERT INTO public.platform_charges (charge_pct, flat_charge, gst_pct, extra_bin_fee_paise)
VALUES (2, 0, 18, 200)
ON CONFLICT DO NOTHING;
