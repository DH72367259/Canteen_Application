-- ============================================================
-- Phase 17: Add missing menu_items columns to staging
-- is_sold_out and is_hidden exist in production but not staging.
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS is_sold_out boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_hidden   boolean NOT NULL DEFAULT false;
