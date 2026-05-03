-- ============================================================
-- Phase 9: Slot capacity enforcement indexes
--
-- The /api/orders/place route now enforces a per-slot order cap
-- (75% of max_bins) server-side by counting orders for the
-- requested slot_label today. This migration adds a covering
-- index so that count query is O(log n) instead of a full scan.
--
-- Idempotent: safe to re-run.
-- ============================================================

-- Fast count of active orders per canteen + slot_label for today.
-- Used by both /api/orders/place (server-side cap) and
-- /api/slots (UI availability) and /api/cart/check (pre-flight).
CREATE INDEX IF NOT EXISTS idx_orders_slot_cap
  ON public.orders (canteen_id, slot_label, created_at)
  WHERE status NOT IN ('cancelled', 'failed', 'refunded');

-- Separate index for the /api/slots route which also filters by
-- canteen_id + created_at to count daily totals.
CREATE INDEX IF NOT EXISTS idx_orders_canteen_created
  ON public.orders (canteen_id, created_at DESC)
  WHERE status NOT IN ('cancelled', 'failed', 'refunded');
