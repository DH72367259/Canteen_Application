-- Phase 18: Configurable slot-visibility window
--
-- Adds slot_visibility_window_mins to slot_control so the canteen manager
-- can choose how far ahead students see slots during checkout:
--   60  → "Min (1 hour)"  — default; matches the previous hardcoded behaviour
--   120 → "Max (2 hours)" — lets students order well in advance
--
-- Read by app/api/slots/route.ts when computing the student-facing window.
ALTER TABLE public.slot_control
  ADD COLUMN IF NOT EXISTS slot_visibility_window_mins int
  NOT NULL DEFAULT 60
  CHECK (slot_visibility_window_mins IN (60, 120));

COMMENT ON COLUMN public.slot_control.slot_visibility_window_mins IS
  'How many minutes into the future the student order-time picker shows slots. 60 = Min (1h), 120 = Max (2h).';
