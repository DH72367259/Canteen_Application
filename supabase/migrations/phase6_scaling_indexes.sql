-- ════════════════════════════════════════════════════════════════════════════
-- phase6_scaling_indexes.sql
--
-- Index pack for the hot query patterns identified during the 28-Apr-2026
-- capacity review. Designed to keep p95 latency under 50 ms when the orders
-- table grows past ~5 million rows (year-1 of mature 600k/month traffic).
--
-- All indexes are created CONCURRENTLY so they do not block writes — safe to
-- run in production. CONCURRENTLY cannot run inside a transaction; if you
-- apply via the Supabase SQL editor, run each statement separately.
--
-- Hot queries that benefit:
--   /api/orders/[id]              — single-row lookup (PK already covers)
--   /api/canteen/live-orders      — orders by canteen + status, last N hours
--   /api/canteen/prep-summary     — orders by canteen + slot
--   /api/subscriptions            — count(*) where user_id=$ and created_at>=
--   /api/orders/place             — order_items inserts (bulk, FK lookup)
--   /api/admin/settlements        — orders by canteen between [from,to]
--   "My orders" page              — orders by user_id ordered by created_at
-- ════════════════════════════════════════════════════════════════════════════

-- "My orders" page + subscription savings count
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_user_created
  ON public.orders (user_id, created_at DESC);

-- Live orders dashboard (polled every 5 s by every active canteen)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_canteen_status_created
  ON public.orders (canteen_id, status, created_at DESC);

-- Settlements + sales reports (canteen + date-range scans)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_canteen_created
  ON public.orders (canteen_id, created_at DESC);

-- Prep summary groups orders by slot for a canteen
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_canteen_slot
  ON public.orders (canteen_id, slot_id)
  WHERE slot_id IS NOT NULL;

-- order_items FK back-reference is read on every order detail / receipt view
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_order_items_order
  ON public.order_items (order_id);

-- Bin assignment lookup ("which order is in this bin right now?")
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_bin
  ON public.orders (bin_id)
  WHERE bin_id IS NOT NULL;

-- payments ledger: idempotency lookup + admin reconciliation by date
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_user_captured
  ON public.payments (user_id, captured_at DESC);

-- ─── Year-2 partitioning recipe (run when orders > ~10M rows) ───────────────
-- ALTER TABLE public.orders RENAME TO orders_legacy;
-- CREATE TABLE public.orders (LIKE public.orders_legacy INCLUDING ALL)
--   PARTITION BY RANGE (created_at);
-- CREATE TABLE public.orders_2026_05 PARTITION OF public.orders
--   FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
-- ... and so on monthly. Use pg_partman for automation.
