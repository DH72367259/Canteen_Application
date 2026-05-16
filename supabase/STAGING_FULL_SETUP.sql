-- ============================================================
-- NoQx Canteen App — COMPLETE STAGING SETUP (idempotent)
-- Run this once in the staging Supabase SQL Editor.
-- Safe to re-run: all statements use IF NOT EXISTS / OR REPLACE /
-- ON CONFLICT DO NOTHING. Seed data is fully dynamic — no hardcoded UUIDs.
-- ============================================================

-- ── Extensions ────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Enums (safe even if they already exist) ───────────────────
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('user','canteen_admin','vendor','worker','super_admin','co_admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE order_status AS ENUM (
    'placed','confirmed','preparing','ready_for_placement','placed_in_bin',
    'ready_for_pickup','collected','cancelled','late_pickup','late_pickup_pending'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Add enum values that migrations added later (safe if already present)
DO $$ BEGIN ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'late_pickup';         EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'late_pickup_pending'; EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE production_type AS ENUM ('batched','made_to_order');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE slot_label AS ENUM ('morning','afternoon','evening');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE reward_tx_type AS ENUM ('earned','redeemed','expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE campaign_status AS ENUM ('draft','scheduled','sent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE log_action AS ENUM ('otp_attempt','manual_override','staff_action');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Core functions ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION get_my_role()
  RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS
$$ SELECT role::text FROM public.profiles WHERE id = auth.uid() $$;

CREATE OR REPLACE FUNCTION get_my_canteen_id()
  RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE AS
$$ SELECT canteen_id FROM public.profiles WHERE id = auth.uid() $$;

CREATE OR REPLACE FUNCTION handle_new_user()
  RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, phone)
  VALUES (
    NEW.id, NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name',
             split_part(COALESCE(NEW.email,''), '@', 1)),
    NEW.phone
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION increment_wallet_balance(p_user_id uuid, p_delta numeric)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.profiles SET wallet_balance = wallet_balance + p_delta, updated_at = now()
  WHERE id = p_user_id;
END; $$;

CREATE OR REPLACE FUNCTION verify_order_otp(p_otp text, p_canteen_id uuid)
  RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_order_id uuid; v_bin_id uuid;
BEGIN
  SELECT id, bin_id INTO v_order_id, v_bin_id FROM public.orders
  WHERE otp = p_otp AND canteen_id = p_canteen_id AND status = 'ready_for_pickup'
    AND (otp_expires_at IS NULL OR otp_expires_at > now()) LIMIT 1;
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired OTP' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.orders SET status = 'collected', updated_at = now() WHERE id = v_order_id;
  IF v_bin_id IS NOT NULL THEN
    UPDATE public.bins SET is_occupied = false, current_order_id = NULL, updated_at = now()
    WHERE id = v_bin_id;
  END IF;
  INSERT INTO public.logs (action_type, target_id, target_type, metadata)
  VALUES ('otp_attempt', v_order_id, 'order',
          jsonb_build_object('status','success','canteen_id',p_canteen_id));
  RETURN v_order_id;
END; $$;

-- ── Tables ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.canteens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  location    text,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- Columns added by phase3 migration
ALTER TABLE public.canteens ADD COLUMN IF NOT EXISTS address    text;
ALTER TABLE public.canteens ADD COLUMN IF NOT EXISTS lat        double precision;
ALTER TABLE public.canteens ADD COLUMN IF NOT EXISTS lng        double precision;
ALTER TABLE public.canteens ADD COLUMN IF NOT EXISTS gmap_link  text;
ALTER TABLE public.canteens ADD COLUMN IF NOT EXISTS status     text NOT NULL DEFAULT 'open';
ALTER TABLE public.canteens ADD COLUMN IF NOT EXISTS city       text;
ALTER TABLE public.canteens ADD COLUMN IF NOT EXISTS college    text;
ALTER TABLE public.canteens ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.canteens DROP CONSTRAINT IF EXISTS canteens_status_check;
ALTER TABLE public.canteens ADD CONSTRAINT canteens_status_check CHECK (status IN ('open','busy','closed'));

CREATE TABLE IF NOT EXISTS public.profiles (
  id              uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text,
  email           text,
  phone           text,
  role            user_role   NOT NULL DEFAULT 'user',
  canteen_id      uuid        REFERENCES public.canteens(id) ON DELETE SET NULL,
  wallet_balance  numeric(10,2) NOT NULL DEFAULT 0.00,
  avatar_url      text,
  username        text UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_phone_unique
  ON public.profiles(phone) WHERE phone IS NOT NULL AND phone <> '';

CREATE TABLE IF NOT EXISTS public.menu_items (
  id                 uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  canteen_id         uuid           NOT NULL REFERENCES public.canteens(id) ON DELETE CASCADE,
  name               text           NOT NULL,
  description        text,
  price              numeric(10,2)  NOT NULL,
  category           text,
  production_type    production_type NOT NULL DEFAULT 'made_to_order',
  image_url          text,
  is_available       boolean        NOT NULL DEFAULT true,
  is_meal            boolean        NOT NULL DEFAULT false,
  availability_type  text           NOT NULL DEFAULT 'batched_prepared',
  quantity_per_slot  int,
  total_per_day      int,
  cancelled_quantity int            NOT NULL DEFAULT 0,
  created_at         timestamptz    NOT NULL DEFAULT now(),
  updated_at         timestamptz    NOT NULL DEFAULT now()
);
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS is_sold_out boolean NOT NULL DEFAULT false;
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS is_hidden   boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.slot_control (
  canteen_id           uuid  PRIMARY KEY REFERENCES public.canteens(id) ON DELETE CASCADE,
  max_bins             int   NOT NULL DEFAULT 60 CHECK (max_bins > 0),
  slot_duration_mins   int   NOT NULL DEFAULT 15 CHECK (slot_duration_mins IN (10,15,20)),
  morning_start        time  NOT NULL DEFAULT '07:00',
  morning_end          time  NOT NULL DEFAULT '11:00',
  afternoon_start      time  NOT NULL DEFAULT '11:30',
  afternoon_end        time  NOT NULL DEFAULT '17:00',
  evening_start        time  NOT NULL DEFAULT '18:00',
  evening_end          time  NOT NULL DEFAULT '21:30',
  grace_period_mins    int   NOT NULL DEFAULT 10 CHECK (grace_period_mins >= 0),
  extra_bin_fee_paise  int   NOT NULL DEFAULT 200 CHECK (extra_bin_fee_paise >= 0),
  meals_per_bin        int   NOT NULL DEFAULT 2 CHECK (meals_per_bin > 0),
  snacks_per_bin       int   NOT NULL DEFAULT 5 CHECK (snacks_per_bin > 0),
  max_orders_per_slot  int   GENERATED ALWAYS AS (max_bins) STORED,
  batched_prepared_cap int   GENERATED ALWAYS AS (FLOOR(max_bins * 0.60)::int) STORED,
  made_to_order_cap    int   GENERATED ALWAYS AS (max_bins - FLOOR(max_bins * 0.60)::int) STORED,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.time_slots (
  id               uuid       PRIMARY KEY DEFAULT gen_random_uuid(),
  canteen_id       uuid       NOT NULL REFERENCES public.canteens(id) ON DELETE CASCADE,
  slot_name        slot_label NOT NULL,
  start_time       time       NOT NULL,
  end_time         time       NOT NULL,
  duration_minutes int        NOT NULL DEFAULT 15,
  is_active        boolean    NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (canteen_id, slot_name)
);

CREATE TABLE IF NOT EXISTS public.bins (
  id                uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  canteen_id        uuid  NOT NULL REFERENCES public.canteens(id) ON DELETE CASCADE,
  bin_code          text  NOT NULL,
  color             text,
  zone_color        text,
  bin_number        int,
  is_occupied       boolean NOT NULL DEFAULT false,
  current_order_id  uuid,
  assigned_order_id uuid,
  slot_label        text,
  status            text  NOT NULL DEFAULT 'empty' CHECK (status IN (
    'empty','preparing','placed','picked','late_pickup','grace_bin',
    'reserved','occupied','disabled'
  )),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (canteen_id, bin_code)
);
ALTER TABLE public.bins ADD COLUMN IF NOT EXISTS zone_color        text;
ALTER TABLE public.bins ADD COLUMN IF NOT EXISTS bin_number        int;
ALTER TABLE public.bins ADD COLUMN IF NOT EXISTS assigned_order_id uuid;
ALTER TABLE public.bins ADD COLUMN IF NOT EXISTS slot_label        text;

CREATE TABLE IF NOT EXISTS public.orders (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid         NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  canteen_id          uuid         NOT NULL REFERENCES public.canteens(id) ON DELETE RESTRICT,
  slot_id             uuid         REFERENCES public.time_slots(id) ON DELETE SET NULL,
  bin_id              uuid         REFERENCES public.bins(id) ON DELETE SET NULL,
  status              order_status NOT NULL DEFAULT 'placed',
  total_amount        numeric(10,2) NOT NULL,
  otp                 text,
  otp_expires_at      timestamptz,
  payment_id          text,
  payment_status      text         DEFAULT 'pending',
  notes               text,
  slot_label          text,
  extra_bin_fee_paise int          NOT NULL DEFAULT 0 CHECK (extra_bin_fee_paise >= 0),
  bin_count           int          NOT NULL DEFAULT 1 CHECK (bin_count >= 1),
  bin_label           text,
  bin_color           text,
  skipped_count       int          NOT NULL DEFAULT 0,
  skipped_at          timestamptz,
  grace_collected_at  timestamptz,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now()
);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS skipped_at         timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS skipped_count      int NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS grace_collected_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS bin_label          text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS bin_color          text;

-- Circular FKs
DO $$ BEGIN
  ALTER TABLE public.bins ADD CONSTRAINT fk_bins_current_order
    FOREIGN KEY (current_order_id) REFERENCES public.orders(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.bins ADD CONSTRAINT fk_bins_assigned_order
    FOREIGN KEY (assigned_order_id) REFERENCES public.orders(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.bins ADD CONSTRAINT fk_bins_assigned_order_id
    FOREIGN KEY (assigned_order_id) REFERENCES public.orders(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.order_bins (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  bin_id     uuid REFERENCES public.bins(id) ON DELETE SET NULL,
  bin_index  int  NOT NULL CHECK (bin_index >= 1),
  bin_code   text,
  bin_color  text,
  items      jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, bin_index)
);

CREATE TABLE IF NOT EXISTS public.order_items (
  id                  uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid           NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  menu_item_id        uuid           NOT NULL REFERENCES public.menu_items(id) ON DELETE RESTRICT,
  quantity            int            NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price          numeric(10,2)  NOT NULL,
  cancelled_quantity  int            NOT NULL DEFAULT 0,
  cancellation_reason text,
  cancelled_at        timestamptz,
  cancelled_by        uuid           REFERENCES public.profiles(id),
  cancelled_by_role   text,
  created_at          timestamptz    NOT NULL DEFAULT now()
);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS cancelled_quantity  int NOT NULL DEFAULT 0;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS cancellation_reason text;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS cancelled_at        timestamptz;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS cancelled_by        uuid REFERENCES public.profiles(id);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS cancelled_by_role   text;
ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_cancelled_quantity_check;
ALTER TABLE public.order_items ADD CONSTRAINT order_items_cancelled_quantity_check
  CHECK (cancelled_quantity >= 0 AND cancelled_quantity <= quantity);

CREATE TABLE IF NOT EXISTS public.rewards (
  id              uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid           NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  points_balance  numeric(10,2)  NOT NULL DEFAULT 0.00,
  last_earned_at  timestamptz,
  expires_at      timestamptz,
  created_at      timestamptz    NOT NULL DEFAULT now(),
  updated_at      timestamptz    NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.reward_transactions (
  id         uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid           NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type       reward_tx_type NOT NULL,
  points     numeric(10,2)  NOT NULL,
  order_id   uuid           REFERENCES public.orders(id) ON DELETE SET NULL,
  reason     text,
  expires_at timestamptz,
  created_at timestamptz    NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.campaigns (
  id             uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  title          text            NOT NULL,
  description    text,
  target_emails  text[]          DEFAULT '{}',
  target_roles   user_role[]     DEFAULT '{}',
  subject        text,
  body           text,
  status         campaign_status NOT NULL DEFAULT 'draft',
  scheduled_at   timestamptz,
  sent_at        timestamptz,
  created_by     uuid            NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at     timestamptz     NOT NULL DEFAULT now(),
  updated_at     timestamptz     NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.logs (
  id          uuid       PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type log_action NOT NULL,
  actor_id    uuid       REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_id   uuid,
  target_type text,
  metadata    jsonb      DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.slots_override (
  id             uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id        uuid  NOT NULL REFERENCES public.time_slots(id) ON DELETE CASCADE,
  override_date  date  NOT NULL,
  max_orders     int,
  is_active      boolean,
  reason         text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slot_id, override_date)
);

CREATE TABLE IF NOT EXISTS public.noqx_pro_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  payment_id text,
  amount_paid numeric NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cart_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  menu_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  canteen_id   uuid NOT NULL REFERENCES public.canteens(id) ON DELETE CASCADE,
  quantity     int  NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, menu_item_id)
);

-- ── Tables from migrations ────────────────────────────────────

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

CREATE TABLE IF NOT EXISTS public.device_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token        text NOT NULL,
  platform     text NOT NULL CHECK (platform IN ('ios','android','web')),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, token)
);

CREATE TABLE IF NOT EXISTS public.sms_otp_codes (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  phone       text        NOT NULL,
  code_hash   text        NOT NULL,
  expires_at  timestamptz NOT NULL DEFAULT (now() + INTERVAL '10 minutes'),
  attempts    int         NOT NULL DEFAULT 0,
  verified_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title          text NOT NULL,
  body           text NOT NULL DEFAULT '',
  type           text NOT NULL DEFAULT 'info',
  recipient_type text NOT NULL DEFAULT 'all'
                      CHECK (recipient_type IN ('all','canteen','user')),
  recipient_id   uuid,
  created_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notification_reads (
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  read_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, notification_id)
);

CREATE TABLE IF NOT EXISTS public.platform_charges (
  id                  uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_pct          numeric NOT NULL DEFAULT 2,
  flat_charge         numeric NOT NULL DEFAULT 0,
  gst_pct             numeric NOT NULL DEFAULT 18,
  extra_bin_fee_paise integer NOT NULL DEFAULT 200,
  updated_by          uuid    REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
-- Seed default global row
INSERT INTO public.platform_charges (charge_pct, flat_charge, gst_pct, extra_bin_fee_paise)
VALUES (2, 0, 18, 200) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.settlement_payments (
  id              uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  canteen_id      uuid  REFERENCES public.canteens(id) ON DELETE SET NULL,
  period_start    date,
  period_end      date,
  gross_amount    numeric NOT NULL DEFAULT 0,
  platform_charge numeric NOT NULL DEFAULT 0,
  gst_on_charge   numeric NOT NULL DEFAULT 0,
  net_payable     numeric NOT NULL DEFAULT 0,
  amount_paid     numeric,
  payment_mode    text,
  transaction_ref text,
  notes           text,
  paid_by         uuid  REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id             uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_ref     text,
  raised_by      uuid  REFERENCES public.profiles(id) ON DELETE SET NULL,
  raised_by_role text,
  canteen_id     uuid  REFERENCES public.canteens(id) ON DELETE SET NULL,
  order_id       uuid  REFERENCES public.orders(id) ON DELETE SET NULL,
  category       text,
  subject        text,
  description    text,
  priority       text  NOT NULL DEFAULT 'medium',
  status         text  NOT NULL DEFAULT 'open',
  admin_notes    text,
  resolved_by    uuid  REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.waste_reports (
  id          uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  canteen_id  uuid  REFERENCES public.canteens(id) ON DELETE SET NULL,
  reported_by uuid  REFERENCES public.profiles(id) ON DELETE SET NULL,
  item_name   text,
  quantity_kg numeric,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_canteens_is_active        ON public.canteens(is_active);
CREATE INDEX IF NOT EXISTS idx_profiles_role             ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_canteen_id       ON public.profiles(canteen_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_canteen_id     ON public.menu_items(canteen_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_is_available   ON public.menu_items(is_available);
CREATE INDEX IF NOT EXISTS idx_time_slots_canteen_id     ON public.time_slots(canteen_id);
CREATE INDEX IF NOT EXISTS idx_bins_canteen_id           ON public.bins(canteen_id);
CREATE INDEX IF NOT EXISTS idx_bins_is_occupied          ON public.bins(is_occupied);
CREATE INDEX IF NOT EXISTS idx_bins_zone_color           ON public.bins(canteen_id, zone_color, bin_number);
CREATE INDEX IF NOT EXISTS idx_bins_assigned_order       ON public.bins(assigned_order_id);
CREATE INDEX IF NOT EXISTS idx_bins_slot_label           ON public.bins(canteen_id, slot_label) WHERE slot_label IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_user_id            ON public.orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_canteen_id         ON public.orders(canteen_id);
CREATE INDEX IF NOT EXISTS idx_orders_status             ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at         ON public.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_bins_order_id       ON public.order_bins(order_id);
CREATE INDEX IF NOT EXISTS idx_order_bins_bin_id         ON public.order_bins(bin_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id      ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_cancelled_at  ON public.order_items(cancelled_at) WHERE cancelled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rewards_user_id           ON public.rewards(user_id);
CREATE INDEX IF NOT EXISTS idx_reward_tx_user_id         ON public.reward_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_canteen          ON public.payments(canteen_id);
CREATE INDEX IF NOT EXISTS idx_payments_user             ON public.payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_order            ON public.payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_captured_at      ON public.payments(captured_at);
CREATE INDEX IF NOT EXISTS idx_device_tokens_user        ON public.device_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_sms_otp_phone_expires     ON public.sms_otp_codes(phone, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient   ON public.notifications(recipient_type, recipient_id);
CREATE INDEX IF NOT EXISTS idx_notification_reads_user   ON public.notification_reads(user_id);
CREATE INDEX IF NOT EXISTS idx_settlement_canteen        ON public.settlement_payments(canteen_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_canteen   ON public.support_tickets(canteen_id);
CREATE INDEX IF NOT EXISTS idx_waste_reports_canteen     ON public.waste_reports(canteen_id);
CREATE INDEX IF NOT EXISTS idx_noqx_pro_user             ON public.noqx_pro_subscriptions(user_id, status);

-- ── Triggers (drop+create = idempotent) ──────────────────────
DROP TRIGGER IF EXISTS trg_canteens_updated_at   ON public.canteens;
CREATE TRIGGER trg_canteens_updated_at   BEFORE UPDATE ON public.canteens   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_profiles_updated_at   ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at   BEFORE UPDATE ON public.profiles   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_menu_items_updated_at ON public.menu_items;
CREATE TRIGGER trg_menu_items_updated_at BEFORE UPDATE ON public.menu_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_slot_control_updated_at ON public.slot_control;
CREATE TRIGGER trg_slot_control_updated_at BEFORE UPDATE ON public.slot_control FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_orders_updated_at     ON public.orders;
CREATE TRIGGER trg_orders_updated_at     BEFORE UPDATE ON public.orders     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS on_auth_user_created      ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE public.profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canteens            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slot_control        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_slots          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bins                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_bins          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rewards             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reward_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logs                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slots_override      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.noqx_pro_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cart_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_tokens       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_otp_codes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_reads  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_charges    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waste_reports       ENABLE ROW LEVEL SECURITY;

-- profiles
DROP POLICY IF EXISTS "profiles: user reads own"   ON public.profiles;
DROP POLICY IF EXISTS "profiles: user updates own"  ON public.profiles;
DROP POLICY IF EXISTS "profiles: super_admin all"   ON public.profiles;
DROP POLICY IF EXISTS "profiles: service full"      ON public.profiles;
CREATE POLICY "profiles: service full"     ON public.profiles FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "profiles: user reads own"   ON public.profiles FOR SELECT USING (auth.uid() = id OR get_my_role() IN ('super_admin','canteen_admin','co_admin'));
CREATE POLICY "profiles: user updates own" ON public.profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles: super_admin all"  ON public.profiles FOR ALL USING (get_my_role() = 'super_admin');

-- canteens
DROP POLICY IF EXISTS "canteens: anyone reads active"       ON public.canteens;
DROP POLICY IF EXISTS "canteens: canteen_admin updates own" ON public.canteens;
DROP POLICY IF EXISTS "canteens: super_admin all"           ON public.canteens;
DROP POLICY IF EXISTS "canteens: service full"              ON public.canteens;
CREATE POLICY "canteens: service full"              ON public.canteens FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "canteens: anyone reads active"       ON public.canteens FOR SELECT USING (is_active = true OR get_my_role() IN ('super_admin','canteen_admin','vendor','worker','co_admin'));
CREATE POLICY "canteens: canteen_admin updates own" ON public.canteens FOR UPDATE USING (id = get_my_canteen_id() AND get_my_role() = 'canteen_admin');
CREATE POLICY "canteens: super_admin all"           ON public.canteens FOR ALL USING (get_my_role() IN ('super_admin','co_admin'));

-- menu_items
DROP POLICY IF EXISTS "menu_items: anyone reads available"   ON public.menu_items;
DROP POLICY IF EXISTS "menu_items: staff manage own canteen" ON public.menu_items;
DROP POLICY IF EXISTS "menu_items: super_admin all"          ON public.menu_items;
DROP POLICY IF EXISTS "menu_items: service full"             ON public.menu_items;
CREATE POLICY "menu_items: service full"             ON public.menu_items FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "menu_items: anyone reads available"   ON public.menu_items FOR SELECT USING (is_available = true OR get_my_role() IN ('super_admin','canteen_admin','vendor'));
CREATE POLICY "menu_items: staff manage own canteen" ON public.menu_items FOR ALL USING (canteen_id = get_my_canteen_id() AND get_my_role() IN ('canteen_admin','vendor'));
CREATE POLICY "menu_items: super_admin all"          ON public.menu_items FOR ALL USING (get_my_role() IN ('super_admin','co_admin'));

-- slot_control
DROP POLICY IF EXISTS "slot_control: service role all"            ON public.slot_control;
DROP POLICY IF EXISTS "slot_control: canteen_admin reads & writes own" ON public.slot_control;
DROP POLICY IF EXISTS "slot_control: canteen_admin updates own"   ON public.slot_control;
CREATE POLICY "slot_control: service role all"  ON public.slot_control FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "slot_control: staff reads own"   ON public.slot_control FOR SELECT USING (canteen_id = get_my_canteen_id() OR get_my_role() IN ('super_admin','co_admin'));
CREATE POLICY "slot_control: staff updates own" ON public.slot_control FOR UPDATE USING ((canteen_id = get_my_canteen_id() AND get_my_role() = 'canteen_admin') OR get_my_role() IN ('super_admin','co_admin'));

-- time_slots
DROP POLICY IF EXISTS "time_slots: anyone reads"            ON public.time_slots;
DROP POLICY IF EXISTS "time_slots: canteen_admin manages own" ON public.time_slots;
DROP POLICY IF EXISTS "time_slots: super_admin all"         ON public.time_slots;
DROP POLICY IF EXISTS "time_slots: service full"            ON public.time_slots;
CREATE POLICY "time_slots: service full"            ON public.time_slots FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "time_slots: anyone reads"            ON public.time_slots FOR SELECT USING (true);
CREATE POLICY "time_slots: canteen_admin manages own" ON public.time_slots FOR ALL USING (canteen_id = get_my_canteen_id() AND get_my_role() IN ('canteen_admin'));
CREATE POLICY "time_slots: super_admin all"         ON public.time_slots FOR ALL USING (get_my_role() IN ('super_admin','co_admin'));

-- bins
DROP POLICY IF EXISTS "bins: staff reads"              ON public.bins;
DROP POLICY IF EXISTS "bins: staff manages own canteen" ON public.bins;
DROP POLICY IF EXISTS "bins: super_admin all"          ON public.bins;
DROP POLICY IF EXISTS "bins: service full"             ON public.bins;
CREATE POLICY "bins: service full"             ON public.bins FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "bins: staff reads"              ON public.bins FOR SELECT USING (get_my_role() IN ('super_admin','canteen_admin','worker','vendor','co_admin') OR canteen_id = get_my_canteen_id());
CREATE POLICY "bins: staff manages own canteen" ON public.bins FOR ALL USING (canteen_id = get_my_canteen_id() AND get_my_role() IN ('canteen_admin','worker'));
CREATE POLICY "bins: super_admin all"          ON public.bins FOR ALL USING (get_my_role() IN ('super_admin','co_admin'));

-- orders
DROP POLICY IF EXISTS "orders: user reads own"          ON public.orders;
DROP POLICY IF EXISTS "orders: user creates own"         ON public.orders;
DROP POLICY IF EXISTS "orders: staff updates own canteen" ON public.orders;
DROP POLICY IF EXISTS "orders: super_admin all"          ON public.orders;
DROP POLICY IF EXISTS "orders: service full"             ON public.orders;
CREATE POLICY "orders: service full"             ON public.orders FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "orders: user reads own"           ON public.orders FOR SELECT USING (user_id = auth.uid() OR get_my_role() IN ('super_admin','canteen_admin','worker','vendor','co_admin'));
CREATE POLICY "orders: user creates own"         ON public.orders FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "orders: staff updates own canteen" ON public.orders FOR UPDATE USING (canteen_id = get_my_canteen_id() AND get_my_role() IN ('canteen_admin','worker','vendor'));
CREATE POLICY "orders: super_admin all"          ON public.orders FOR ALL USING (get_my_role() IN ('super_admin','co_admin'));

-- order_bins
DROP POLICY IF EXISTS "order_bins: user reads own" ON public.order_bins;
DROP POLICY IF EXISTS "order_bins: service full"   ON public.order_bins;
CREATE POLICY "order_bins: service full"   ON public.order_bins FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "order_bins: user reads own" ON public.order_bins FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_bins.order_id AND (
    o.user_id = auth.uid() OR
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('canteen_admin','vendor','worker','super_admin','co_admin'))
  ))
);

-- order_items
DROP POLICY IF EXISTS "order_items: user reads own"              ON public.order_items;
DROP POLICY IF EXISTS "order_items: user inserts for own order"  ON public.order_items;
DROP POLICY IF EXISTS "order_items: service full"                ON public.order_items;
CREATE POLICY "order_items: service full"               ON public.order_items FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "order_items: user reads own"             ON public.order_items FOR SELECT USING (EXISTS (SELECT 1 FROM public.orders WHERE orders.id = order_items.order_id AND (orders.user_id = auth.uid() OR get_my_role() IN ('super_admin','canteen_admin','worker','vendor','co_admin'))));
CREATE POLICY "order_items: user inserts for own order" ON public.order_items FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.orders WHERE orders.id = order_items.order_id AND orders.user_id = auth.uid()));

-- remaining tables (service_role full access + scoped reads)
DROP POLICY IF EXISTS "rewards: user reads own"   ON public.rewards;
DROP POLICY IF EXISTS "rewards: super_admin all"  ON public.rewards;
DROP POLICY IF EXISTS "rewards: service full"     ON public.rewards;
CREATE POLICY "rewards: service full"    ON public.rewards FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "rewards: user reads own"  ON public.rewards FOR SELECT USING (user_id = auth.uid() OR get_my_role() = 'super_admin');
CREATE POLICY "rewards: super_admin all" ON public.rewards FOR ALL USING (get_my_role() = 'super_admin');

DROP POLICY IF EXISTS "reward_tx: user reads own"  ON public.reward_transactions;
DROP POLICY IF EXISTS "reward_tx: super_admin all" ON public.reward_transactions;
DROP POLICY IF EXISTS "reward_tx: service full"    ON public.reward_transactions;
CREATE POLICY "reward_tx: service full"   ON public.reward_transactions FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "reward_tx: user reads own" ON public.reward_transactions FOR SELECT USING (user_id = auth.uid() OR get_my_role() = 'super_admin');

DROP POLICY IF EXISTS "campaigns: super_admin all" ON public.campaigns;
DROP POLICY IF EXISTS "campaigns: service full"    ON public.campaigns;
CREATE POLICY "campaigns: service full"   ON public.campaigns FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "campaigns: super_admin all" ON public.campaigns FOR ALL USING (get_my_role() IN ('super_admin','co_admin'));

DROP POLICY IF EXISTS "logs: staff reads"   ON public.logs;
DROP POLICY IF EXISTS "logs: anyone inserts" ON public.logs;
DROP POLICY IF EXISTS "logs: service full"  ON public.logs;
CREATE POLICY "logs: service full"   ON public.logs FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "logs: staff reads"    ON public.logs FOR SELECT USING (get_my_role() IN ('super_admin','canteen_admin','co_admin'));
CREATE POLICY "logs: anyone inserts" ON public.logs FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "slots_override: anyone reads"     ON public.slots_override;
DROP POLICY IF EXISTS "slots_override: canteen_admin manages" ON public.slots_override;
DROP POLICY IF EXISTS "slots_override: super_admin all"  ON public.slots_override;
DROP POLICY IF EXISTS "slots_override: service full"     ON public.slots_override;
CREATE POLICY "slots_override: service full"     ON public.slots_override FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "slots_override: anyone reads"     ON public.slots_override FOR SELECT USING (true);
CREATE POLICY "slots_override: super_admin all"  ON public.slots_override FOR ALL USING (get_my_role() IN ('super_admin','co_admin'));

DROP POLICY IF EXISTS "noqx_pro: users read own" ON public.noqx_pro_subscriptions;
DROP POLICY IF EXISTS "noqx_pro: service full"   ON public.noqx_pro_subscriptions;
CREATE POLICY "noqx_pro: service full"   ON public.noqx_pro_subscriptions FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "noqx_pro: users read own" ON public.noqx_pro_subscriptions FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "cart_items: users manage own" ON public.cart_items;
DROP POLICY IF EXISTS "cart_items: service full"     ON public.cart_items;
CREATE POLICY "cart_items: service full"     ON public.cart_items FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "cart_items: users manage own" ON public.cart_items FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "payments: service full"     ON public.payments;
DROP POLICY IF EXISTS "payments_admin_read"        ON public.payments;
DROP POLICY IF EXISTS "payments_owner_read"        ON public.payments;
DROP POLICY IF EXISTS "payments_canteen_read"      ON public.payments;
CREATE POLICY "payments: service full"    ON public.payments FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "payments: admin read"      ON public.payments FOR SELECT USING (get_my_role() IN ('super_admin','co_admin'));
CREATE POLICY "payments: owner read"      ON public.payments FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "payments: canteen read"    ON public.payments FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('canteen_admin','vendor','worker') AND canteen_id = payments.canteen_id));

DROP POLICY IF EXISTS "device_tokens_owner"  ON public.device_tokens;
DROP POLICY IF EXISTS "device_tokens: service full" ON public.device_tokens;
CREATE POLICY "device_tokens: service full" ON public.device_tokens FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "device_tokens: owner"        ON public.device_tokens FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "service_role_only"         ON public.sms_otp_codes;
CREATE POLICY "sms_otp: service full" ON public.sms_otp_codes FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "notifications: service full"         ON public.notifications;
DROP POLICY IF EXISTS "notifications: users read relevant"  ON public.notifications;
CREATE POLICY "notifications: service full"        ON public.notifications FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "notifications: users read relevant" ON public.notifications FOR SELECT USING (recipient_type = 'all' OR (recipient_type = 'user' AND recipient_id = auth.uid()) OR get_my_role() IN ('super_admin','co_admin'));

DROP POLICY IF EXISTS "notification_reads: service full" ON public.notification_reads;
DROP POLICY IF EXISTS "notification_reads: own"          ON public.notification_reads;
CREATE POLICY "notification_reads: service full" ON public.notification_reads FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "notification_reads: own"          ON public.notification_reads FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "platform_charges: admin only"  ON public.platform_charges;
DROP POLICY IF EXISTS "platform_charges: service full" ON public.platform_charges;
CREATE POLICY "platform_charges: service full" ON public.platform_charges FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "platform_charges: admin read"   ON public.platform_charges FOR SELECT USING (get_my_role() IN ('super_admin','co_admin','canteen_admin','vendor'));

DROP POLICY IF EXISTS "settlement_payments: service full"  ON public.settlement_payments;
DROP POLICY IF EXISTS "settlement_payments: admin read"    ON public.settlement_payments;
DROP POLICY IF EXISTS "settlement_payments: canteen read"  ON public.settlement_payments;
CREATE POLICY "settlement_payments: service full"  ON public.settlement_payments FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "settlement_payments: admin read"    ON public.settlement_payments FOR SELECT USING (get_my_role() IN ('super_admin','co_admin'));
CREATE POLICY "settlement_payments: canteen read"  ON public.settlement_payments FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('canteen_admin','vendor') AND canteen_id = settlement_payments.canteen_id));

DROP POLICY IF EXISTS "support_tickets: service full"    ON public.support_tickets;
DROP POLICY IF EXISTS "support_tickets: user read own"   ON public.support_tickets;
CREATE POLICY "support_tickets: service full"   ON public.support_tickets FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "support_tickets: user read own"  ON public.support_tickets FOR SELECT USING (raised_by = auth.uid() OR get_my_role() IN ('super_admin','co_admin','canteen_admin'));

DROP POLICY IF EXISTS "waste_reports: service full"  ON public.waste_reports;
DROP POLICY IF EXISTS "waste_reports: canteen read"  ON public.waste_reports;
CREATE POLICY "waste_reports: service full"  ON public.waste_reports FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "waste_reports: canteen read"  ON public.waste_reports FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND canteen_id = waste_reports.canteen_id));

-- ── Dynamic seed data (no hardcoded UUIDs) ────────────────────
DO $$
DECLARE
  v_c1  uuid;
  v_c2  uuid;
  v_row record;
  v_n   int;
BEGIN
  -- ── Canteen 1: find or create for canteen1@noqx.test ──────
  SELECT canteen_id INTO v_c1 FROM public.profiles WHERE email = 'canteen1@noqx.test' LIMIT 1;

  IF v_c1 IS NULL THEN
    INSERT INTO public.canteens (name, location, is_active, status)
    VALUES ('NoQx Test Canteen', 'Block A, Test Campus', true, 'open')
    RETURNING id INTO v_c1;
  END IF;

  UPDATE public.profiles SET canteen_id = v_c1
  WHERE email IN ('canteen1@noqx.test', 'worker1@noqx.test')
    AND (canteen_id IS NULL OR canteen_id != v_c1);

  -- ── Canteen 2: find or create for canteen2@noqx.test ──────
  SELECT canteen_id INTO v_c2 FROM public.profiles WHERE email = 'canteen2@noqx.test' LIMIT 1;

  IF v_c2 IS NULL OR v_c2 = v_c1 THEN
    INSERT INTO public.canteens (name, location, is_active, status)
    VALUES ('NoQx Test Canteen 2', 'Block B, Test Campus', true, 'open')
    RETURNING id INTO v_c2;
  END IF;

  UPDATE public.profiles SET canteen_id = v_c2
  WHERE email = 'canteen2@noqx.test'
    AND (canteen_id IS NULL OR canteen_id != v_c2);

  -- ── slot_control ──────────────────────────────────────────
  INSERT INTO public.slot_control (canteen_id, max_bins)
  VALUES (v_c1, 60), (v_c2, 60)
  ON CONFLICT (canteen_id) DO NOTHING;

  -- ── Bins: 6 zones × 10 per canteen ───────────────────────
  FOR v_row IN SELECT abbr, color FROM (VALUES
    ('RED','red'), ('YEL','yellow'), ('GRE','green'),
    ('BLU','blue'), ('PUR','purple'), ('ORA','orange')
  ) AS t(abbr, color) LOOP
    FOR v_n IN 1..10 LOOP
      INSERT INTO public.bins (canteen_id, bin_code, color, zone_color, bin_number, is_occupied, status)
      VALUES
        (v_c1, '#' || v_row.abbr || LPAD(v_n::text,3,'0'), v_row.color, v_row.color, v_n, false, 'empty'),
        (v_c2, '#' || v_row.abbr || LPAD(v_n::text,3,'0'), v_row.color, v_row.color, v_n, false, 'empty')
      ON CONFLICT (canteen_id, bin_code) DO NOTHING;
    END LOOP;
  END LOOP;

  -- ── Menu items for canteen 1 ──────────────────────────────
  FOR v_row IN SELECT * FROM (VALUES
    ('Paneer Rice',    'Paneer fried rice combo',           80.00, 'Meals',     'batched',       true,  'batched_prepared', 30, 150),
    ('Dal Roti Combo', 'Dal with 3 rotis and salad',        60.00, 'Meals',     'batched',       true,  'batched_prepared', 25, 100),
    ('Chicken Biryani','Full plate chicken biryani',        120.00,'Meals',     'made_to_order', true,  'made_to_order',    NULL, NULL),
    ('Veg Thali',      'Complete veg meal',                 70.00, 'Meals',     'batched',       true,  'slot_based',       20, NULL),
    ('Samosa',         'Crispy potato samosa (2 pcs)',      20.00, 'Snacks',    'batched',       false, 'batched_prepared', 50, 200),
    ('Chai',           'Masala tea',                        10.00, 'Beverages', 'made_to_order', false, 'made_to_order',    NULL, NULL),
    ('Cold Coffee',    'Chilled coffee with milk',          40.00, 'Beverages', 'made_to_order', false, 'made_to_order',    NULL, NULL),
    ('Bread Omelette', 'Egg omelette with bread slices',   35.00, 'Snacks',    'made_to_order', false, 'made_to_order',    NULL, NULL),
    ('Poha',           'Flattened rice snack',              25.00, 'Snacks',    'batched',       false, 'slot_based',       40, 160),
    ('Sandwich',       'Veg grilled sandwich',              45.00, 'Snacks',    'made_to_order', false, 'made_to_order',    NULL, NULL)
  ) AS t(name, description, price, category, prod_type, is_meal, avail_type, qty_slot, total_day) LOOP
    INSERT INTO public.menu_items
      (canteen_id, name, description, price, category, production_type,
       is_available, is_meal, availability_type, quantity_per_slot, total_per_day)
    SELECT v_c1, v_row.name, v_row.description, v_row.price, v_row.category,
           v_row.prod_type::production_type, true, v_row.is_meal,
           v_row.avail_type, v_row.qty_slot, v_row.total_day
    WHERE NOT EXISTS (
      SELECT 1 FROM public.menu_items WHERE canteen_id = v_c1 AND name = v_row.name
    );
  END LOOP;

  -- ── Menu items for canteen 2 ──────────────────────────────
  FOR v_row IN SELECT * FROM (VALUES
    ('Rajma Rice',   'Rajma chawal comfort meal',           65.00, 'Meals',     'batched',       true,  'batched_prepared', 25, 120),
    ('Egg Curry Rice','Egg curry with steamed rice',        75.00, 'Meals',     'made_to_order', true,  'made_to_order',    NULL, NULL),
    ('Idli Sambar',  'Soft idlis with sambar and chutney', 30.00, 'Snacks',    'batched',       false, 'batched_prepared', 60, 200),
    ('Coffee',       'Hot filter coffee',                   15.00, 'Beverages', 'made_to_order', false, 'made_to_order',    NULL, NULL),
    ('Vada Pav',     'Mumbai style vada pav',               25.00, 'Snacks',    'batched',       false, 'slot_based',       45, 180)
  ) AS t(name, description, price, category, prod_type, is_meal, avail_type, qty_slot, total_day) LOOP
    INSERT INTO public.menu_items
      (canteen_id, name, description, price, category, production_type,
       is_available, is_meal, availability_type, quantity_per_slot, total_per_day)
    SELECT v_c2, v_row.name, v_row.description, v_row.price, v_row.category,
           v_row.prod_type::production_type, true, v_row.is_meal,
           v_row.avail_type, v_row.qty_slot, v_row.total_day
    WHERE NOT EXISTS (
      SELECT 1 FROM public.menu_items WHERE canteen_id = v_c2 AND name = v_row.name
    );
  END LOOP;

  RAISE NOTICE 'Seed complete. Canteen1=% Canteen2=%', v_c1, v_c2;
END $$;
