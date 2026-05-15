-- ============================================================
-- Apply missing tables to staging Supabase
-- Tables that exist in production but were never scripted:
--   platform_charges, settlement_payments, support_tickets, waste_reports
-- Plus migrations not yet applied: device_tokens, sms_otp_codes,
--   payments, notifications, notification_reads
-- All statements are idempotent (CREATE TABLE IF NOT EXISTS)
-- ============================================================

-- 1. platform_charges (global platform fee config — one row)
CREATE TABLE IF NOT EXISTS public.platform_charges (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_pct  numeric     NOT NULL DEFAULT 2,
  flat_charge numeric     NOT NULL DEFAULT 0,
  gst_pct     numeric     NOT NULL DEFAULT 18,
  updated_by  uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_charges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "platform_charges: admin only" ON public.platform_charges;
CREATE POLICY "platform_charges: admin only"
  ON public.platform_charges FOR ALL
  USING (auth.role() = 'service_role');

-- 2. settlement_payments (bulk admin → canteen payout records)
CREATE TABLE IF NOT EXISTS public.settlement_payments (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  canteen_id       uuid        REFERENCES public.canteens(id) ON DELETE SET NULL,
  period_start     date,
  period_end       date,
  gross_amount     numeric     NOT NULL DEFAULT 0,
  platform_charge  numeric     NOT NULL DEFAULT 0,
  gst_on_charge    numeric     NOT NULL DEFAULT 0,
  net_payable      numeric     NOT NULL DEFAULT 0,
  amount_paid      numeric,
  payment_mode     text,
  transaction_ref  text,
  notes            text,
  paid_by          uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.settlement_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "settlement_payments: service full" ON public.settlement_payments;
CREATE POLICY "settlement_payments: service full"
  ON public.settlement_payments FOR ALL
  USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "settlement_payments: admin read" ON public.settlement_payments;
CREATE POLICY "settlement_payments: admin read"
  ON public.settlement_payments FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('super_admin','co_admin')));
DROP POLICY IF EXISTS "settlement_payments: canteen read" ON public.settlement_payments;
CREATE POLICY "settlement_payments: canteen read"
  ON public.settlement_payments FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('canteen_admin','vendor') AND canteen_id = settlement_payments.canteen_id));
CREATE INDEX IF NOT EXISTS idx_settlement_canteen ON public.settlement_payments(canteen_id);
CREATE INDEX IF NOT EXISTS idx_settlement_period  ON public.settlement_payments(period_start, period_end);

-- 3. support_tickets
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_ref      text,
  raised_by       uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  raised_by_role  text,
  canteen_id      uuid        REFERENCES public.canteens(id) ON DELETE SET NULL,
  order_id        uuid        REFERENCES public.orders(id) ON DELETE SET NULL,
  category        text,
  subject         text,
  description     text,
  priority        text        NOT NULL DEFAULT 'medium',
  status          text        NOT NULL DEFAULT 'open',
  admin_notes     text,
  resolved_by     uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "support_tickets: service full" ON public.support_tickets;
CREATE POLICY "support_tickets: service full"
  ON public.support_tickets FOR ALL
  USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "support_tickets: user read own" ON public.support_tickets;
CREATE POLICY "support_tickets: user read own"
  ON public.support_tickets FOR SELECT
  USING (raised_by = auth.uid());
CREATE INDEX IF NOT EXISTS idx_support_tickets_canteen ON public.support_tickets(canteen_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status  ON public.support_tickets(status);

-- 4. waste_reports
CREATE TABLE IF NOT EXISTS public.waste_reports (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  canteen_id   uuid        REFERENCES public.canteens(id) ON DELETE SET NULL,
  reported_by  uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  item_name    text,
  quantity_kg  numeric,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.waste_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "waste_reports: service full" ON public.waste_reports;
CREATE POLICY "waste_reports: service full"
  ON public.waste_reports FOR ALL
  USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "waste_reports: canteen read" ON public.waste_reports;
CREATE POLICY "waste_reports: canteen read"
  ON public.waste_reports FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND canteen_id = waste_reports.canteen_id));
CREATE INDEX IF NOT EXISTS idx_waste_reports_canteen ON public.waste_reports(canteen_id);

-- 5. device_tokens (phase5)
CREATE TABLE IF NOT EXISTS public.device_tokens (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token         text        NOT NULL,
  platform      text        NOT NULL CHECK (platform IN ('ios','android','web')),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, token)
);
CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON public.device_tokens(user_id);
ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS device_tokens_owner ON public.device_tokens;
CREATE POLICY device_tokens_owner ON public.device_tokens
  FOR SELECT USING (user_id = auth.uid());

-- 6. sms_otp_codes (phase10)
CREATE TABLE IF NOT EXISTS public.sms_otp_codes (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  phone       text        NOT NULL,
  code_hash   text        NOT NULL,
  expires_at  timestamptz NOT NULL DEFAULT (now() + INTERVAL '10 minutes'),
  attempts    int         NOT NULL DEFAULT 0,
  verified_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sms_otp_phone_expires ON public.sms_otp_codes(phone, expires_at DESC);
ALTER TABLE public.sms_otp_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_only" ON public.sms_otp_codes;
CREATE POLICY "service_role_only" ON public.sms_otp_codes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 7. payments ledger (phase4)
CREATE TABLE IF NOT EXISTS public.payments (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  razorpay_order_id     text        NOT NULL,
  razorpay_payment_id   text        NOT NULL UNIQUE,
  razorpay_signature    text,
  order_id              uuid        REFERENCES public.orders(id) ON DELETE SET NULL,
  user_id               uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  canteen_id            uuid        REFERENCES public.canteens(id) ON DELETE SET NULL,
  amount_paise          integer     NOT NULL CHECK (amount_paise > 0),
  currency              text        NOT NULL DEFAULT 'INR',
  charge_pct_snapshot   numeric(5,2)  NOT NULL DEFAULT 0,
  flat_charge_snapshot  numeric(8,2)  NOT NULL DEFAULT 0,
  gst_pct_snapshot      numeric(5,2)  NOT NULL DEFAULT 0,
  platform_earnings     numeric(10,2) NOT NULL DEFAULT 0,
  gst_on_charge         numeric(10,2) NOT NULL DEFAULT 0,
  net_to_canteen        numeric(10,2) NOT NULL DEFAULT 0,
  status                text        NOT NULL DEFAULT 'captured'
                        CHECK (status IN ('created','captured','failed','refunded','partial_refund')),
  refunded_amount_paise integer     NOT NULL DEFAULT 0,
  raw_event             jsonb,
  captured_at           timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_canteen     ON public.payments(canteen_id);
CREATE INDEX IF NOT EXISTS idx_payments_user        ON public.payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_order       ON public.payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_captured_at ON public.payments(captured_at);
CREATE INDEX IF NOT EXISTS idx_payments_status      ON public.payments(status);
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payments_admin_read   ON public.payments;
DROP POLICY IF EXISTS payments_owner_read   ON public.payments;
DROP POLICY IF EXISTS payments_canteen_read ON public.payments;
CREATE POLICY payments_admin_read ON public.payments
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('super_admin','co_admin')));
CREATE POLICY payments_owner_read ON public.payments
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY payments_canteen_read ON public.payments
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('canteen_admin','vendor','worker') AND canteen_id = payments.canteen_id));

-- 8. notifications + notification_reads (fix_schema_and_auth)
CREATE TABLE IF NOT EXISTS public.notifications (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title          text        NOT NULL,
  body           text        NOT NULL DEFAULT '',
  type           text        NOT NULL DEFAULT 'info',
  recipient_type text        NOT NULL DEFAULT 'all'
                             CHECK (recipient_type IN ('all','canteen','user')),
  recipient_id   uuid,
  created_by     uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.notification_reads (
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  read_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, notification_id)
);
ALTER TABLE public.notifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notifications: service full"         ON public.notifications;
DROP POLICY IF EXISTS "notifications: users read relevant"  ON public.notifications;
DROP POLICY IF EXISTS "notification_reads: service full"    ON public.notification_reads;
DROP POLICY IF EXISTS "notification_reads: own"             ON public.notification_reads;
CREATE POLICY "notifications: service full" ON public.notifications FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "notifications: users read relevant" ON public.notifications FOR SELECT
  USING (recipient_type = 'all' OR (recipient_type = 'user' AND recipient_id = auth.uid()) OR get_my_role() IN ('super_admin','co_admin'));
CREATE POLICY "notification_reads: service full" ON public.notification_reads FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "notification_reads: own" ON public.notification_reads FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE INDEX IF NOT EXISTS idx_notifications_recipient  ON public.notifications(recipient_type, recipient_id);
CREATE INDEX IF NOT EXISTS idx_notification_reads_user  ON public.notification_reads(user_id);
