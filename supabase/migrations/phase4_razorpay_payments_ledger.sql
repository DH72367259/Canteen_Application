-- ============================================================
-- Phase 4: Razorpay payments audit ledger + per-transaction commission snapshot
-- ============================================================
-- Why a new table?
--   - `orders` records WHAT was ordered (cart, OTP, bin)
--   - `settlement_payments` records bulk admin → canteen payouts
--   - But there is no per-transaction record of the Razorpay capture itself
--     with the commission breakdown computed at the moment of payment.
--
--   This table fills that gap: one row per successful Razorpay payment,
--   with the gross / platform_charge / gst / net_to_canteen snapshot frozen
--   at capture time so future tariff changes never retroactively affect old
--   payouts. Webhooks insert idempotently using razorpay_payment_id as the
--   natural unique key.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.payments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Razorpay identifiers (the audit trail) ------------------------------
  razorpay_order_id     text NOT NULL,
  razorpay_payment_id   text NOT NULL UNIQUE,
  razorpay_signature    text,
  -- Application linkage --------------------------------------------------
  order_id              uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  user_id               uuid REFERENCES auth.users(id)    ON DELETE SET NULL,
  canteen_id            uuid REFERENCES public.canteens(id) ON DELETE SET NULL,
  -- Money (paise — never store rupees in payment systems) ---------------
  amount_paise          integer NOT NULL CHECK (amount_paise > 0),
  currency              text    NOT NULL DEFAULT 'INR',
  -- Commission snapshot at capture time (rupees, 2 dp) ------------------
  charge_pct_snapshot   numeric(5,2)  NOT NULL DEFAULT 0,
  flat_charge_snapshot  numeric(8,2)  NOT NULL DEFAULT 0,
  gst_pct_snapshot      numeric(5,2)  NOT NULL DEFAULT 0,
  platform_earnings     numeric(10,2) NOT NULL DEFAULT 0,
  gst_on_charge         numeric(10,2) NOT NULL DEFAULT 0,
  net_to_canteen        numeric(10,2) NOT NULL DEFAULT 0,
  -- Lifecycle ------------------------------------------------------------
  status                text NOT NULL DEFAULT 'captured'
                          CHECK (status IN ('created','captured','failed','refunded','partial_refund')),
  refunded_amount_paise integer NOT NULL DEFAULT 0,
  raw_event             jsonb,                       -- last webhook event for forensics
  captured_at           timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_canteen        ON public.payments(canteen_id);
CREATE INDEX IF NOT EXISTS idx_payments_user           ON public.payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_order          ON public.payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_captured_at    ON public.payments(captured_at);
CREATE INDEX IF NOT EXISTS idx_payments_status         ON public.payments(status);

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS automatically; the explicit policies below let
-- super_admins read everything, canteen managers see only their own canteen,
-- and users see only their own payments. The webhook handler uses the service
-- role so writes are unaffected.
DROP POLICY IF EXISTS payments_admin_read   ON public.payments;
DROP POLICY IF EXISTS payments_owner_read   ON public.payments;
DROP POLICY IF EXISTS payments_canteen_read ON public.payments;

CREATE POLICY payments_admin_read ON public.payments
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles
            WHERE id = auth.uid() AND role IN ('super_admin','co_admin'))
  );

CREATE POLICY payments_owner_read ON public.payments
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY payments_canteen_read ON public.payments
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles
            WHERE id = auth.uid()
              AND role IN ('canteen_admin','vendor','worker')
              AND canteen_id = payments.canteen_id)
  );
