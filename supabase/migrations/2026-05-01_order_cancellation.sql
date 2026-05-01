-- ============================================================
-- 2026-05-01: Order cancellation tracking
--
-- Adds explicit cancellation metadata so the canteen manager and
-- platform admin can cancel an accepted order with a mandatory
-- reason that is visible to the student, admin, and canteen-admin
-- views, plus auto-refund tracking for Razorpay.
--
-- All columns are nullable / additive so this is safe to run on a
-- live DB at any time.
-- ============================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_by        uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS cancelled_by_role   text,
  ADD COLUMN IF NOT EXISTS cancelled_at        timestamptz,
  ADD COLUMN IF NOT EXISTS refund_id           text,
  ADD COLUMN IF NOT EXISTS refund_status       text;
  -- refund_status values used by the app:
  --   pending       — refund attempt not yet tried (e.g. queued)
  --   processed     — Razorpay refund accepted (id stored in refund_id)
  --   failed        — Razorpay refund call returned an error (see logs)
  --   not_required  — no real payment to refund (FREE orders, test mode)

CREATE INDEX IF NOT EXISTS idx_orders_cancelled_at ON public.orders(cancelled_at)
  WHERE cancelled_at IS NOT NULL;
