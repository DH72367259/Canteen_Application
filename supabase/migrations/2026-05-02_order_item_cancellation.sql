-- ============================================================
-- 2026-05-02: Per-item cancellation tracking
--
-- Enables partial line-item cancellation with proportional refunds.
-- ============================================================

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS cancelled_quantity int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS cancelled_by_role text;

ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS order_items_cancelled_quantity_check;

ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_cancelled_quantity_check
  CHECK (cancelled_quantity >= 0 AND cancelled_quantity <= quantity);

CREATE INDEX IF NOT EXISTS idx_order_items_cancelled_at
  ON public.order_items(cancelled_at)
  WHERE cancelled_at IS NOT NULL;
