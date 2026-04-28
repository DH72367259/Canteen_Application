-- ============================================================
-- Phase: align canteens table with API + admin-create endpoints
-- ============================================================
-- The original `supabase-setup.sql` defined canteens with only
-- (id, name, college, city, is_active, created_at). The user app
-- (`/api/canteens`) selects address/lat/lng/status, and the admin
-- create-canteen endpoint inserts gmap_link too. Without these
-- columns the SELECT returns 500 and the INSERT fails — which is
-- why the client reported "Failed to create canteen" / no cards.
--
-- This migration is fully idempotent (IF NOT EXISTS everywhere).
-- ============================================================

ALTER TABLE public.canteens
  ADD COLUMN IF NOT EXISTS address    text,
  ADD COLUMN IF NOT EXISTS lat        double precision,
  ADD COLUMN IF NOT EXISTS lng        double precision,
  ADD COLUMN IF NOT EXISTS gmap_link  text,
  ADD COLUMN IF NOT EXISTS status     text NOT NULL DEFAULT 'open';

-- Constrain status to known values. Drop-then-add so re-running is safe.
ALTER TABLE public.canteens
  DROP CONSTRAINT IF EXISTS canteens_status_check;
ALTER TABLE public.canteens
  ADD CONSTRAINT canteens_status_check
  CHECK (status IN ('open', 'busy', 'closed'));
