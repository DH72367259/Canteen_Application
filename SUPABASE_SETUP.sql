-- ============================================================
-- SUPABASE SETUP SCRIPT
-- Run this in your Supabase SQL Editor to complete all migrations
--
-- Project: https://dpycfyeiyhzvwbythcrp.supabase.co
-- ============================================================

-- ============================================================
-- PHASE 10: Add username field for worker/staff login
-- ============================================================
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS username text UNIQUE;

CREATE INDEX IF NOT EXISTS idx_profiles_username
  ON public.profiles(username)
  WHERE username IS NOT NULL;

-- Grant permissions for auth lookups
GRANT SELECT (username, email) ON public.profiles TO anon;

-- ============================================================
-- SEED TEST ACCOUNTS with usernames
-- ============================================================
-- Helper: insert an auth user + matching profile in one transaction.
-- Idempotent — re-running is safe (uses ON CONFLICT)
do $$
declare
  v_users  jsonb := '[
    {"email":"admin@noqx.test",    "pwd":"Admin@12345",   "name":"Super Admin",    "role":"super_admin", "username":"admin_user"},
    {"email":"canteen1@noqx.test", "pwd":"Canteen@12345", "name":"Canteen One",    "role":"canteen_admin", "username":"canteen_admin_1"},
    {"email":"canteen2@noqx.test", "pwd":"Canteen@12345", "name":"Canteen Two",    "role":"canteen_admin", "username":"canteen_admin_2"},
    {"email":"worker1@noqx.test",  "pwd":"Worker@12345",  "name":"Worker One",     "role":"worker", "username":"worker_1"},
    {"email":"coadmin@noqx.test",  "pwd":"Coadmin@12345", "name":"Co Administrator","role":"co_admin", "username":"coadmin_user"}
  ]'::jsonb;
  v_row   jsonb;
  v_uid   uuid;
  v_email text;
  v_pwd   text;
  v_name  text;
  v_role  text;
  v_username text;
begin
  for v_row in select * from jsonb_array_elements(v_users) loop
    v_email := v_row->>'email';
    v_pwd   := v_row->>'pwd';
    v_name  := v_row->>'name';
    v_role  := v_row->>'role';
    v_username := v_row->>'username';

    -- Skip if already exists
    select id into v_uid from auth.users where email = v_email;
    if v_uid is not null then
      -- Update existing user's profile with username
      update public.profiles
      set username = v_username, name = v_name, role = v_role
      where id = v_uid;
      raise notice 'Updated % with username %', v_email, v_username;
      continue;
    end if;

    v_uid := gen_random_uuid();

    insert into auth.users (
      id, instance_id, aud, role,
      email, encrypted_password,
      email_confirmed_at, confirmation_sent_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      is_sso_user, is_anonymous
    ) values (
      v_uid,
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated',
      v_email,
      crypt(v_pwd, gen_salt('bf')),
      now(), now(),
      jsonb_build_object('provider','email','providers',jsonb_build_array('email')),
      jsonb_build_object('name', v_name, 'has_password', true),
      now(), now(),
      false, false
    );

    -- Identity row (required for email/password login)
    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
      'email', v_email,
      now(), now(), now()
    );

    -- Profile row with username
    insert into public.profiles (id, name, email, role, username, created_at)
    values (v_uid, v_name, v_email, v_role, v_username, now())
    on conflict (id) do update
    set name = excluded.name,
        role = excluded.role,
        email = excluded.email,
        username = excluded.username;

    raise notice 'Created % as % with username % (uid=%)', v_email, v_role, v_username, v_uid;
  end loop;
end $$;

-- ============================================================
-- PHASE 11: Remove 75/25 Slot Capacity Split
-- All bins are now available for each slot (100% capacity)
-- ============================================================
ALTER TABLE public.slot_control
  DROP COLUMN IF EXISTS max_orders_per_slot,
  DROP COLUMN IF EXISTS batched_prepared_cap,
  DROP COLUMN IF EXISTS made_to_order_cap;

ALTER TABLE public.slot_control
  ADD COLUMN max_orders_per_slot int GENERATED ALWAYS AS (max_bins) STORED,
  ADD COLUMN batched_prepared_cap int GENERATED ALWAYS AS (FLOOR(max_bins * 0.60)::int) STORED,
  ADD COLUMN made_to_order_cap int GENERATED ALWAYS AS (max_bins - FLOOR(max_bins * 0.60)::int) STORED;

-- ============================================================
-- PHASE 12: Add slot_label to bins table
-- CRITICAL: Without this column every bin claim and release silently
-- fails because PostgREST rejects UPDATEs with unknown columns.
-- This causes all orders to fall back to the synthetic bin and
-- leaves bins permanently stuck in Reserved state.
-- ============================================================
ALTER TABLE public.bins
  ADD COLUMN IF NOT EXISTS slot_label text;

CREATE INDEX IF NOT EXISTS idx_bins_slot_label
  ON public.bins(canteen_id, slot_label)
  WHERE slot_label IS NOT NULL;

-- ============================================================
-- PHASE 13: Document + create missing reference tables
-- ============================================================
CREATE TABLE IF NOT EXISTS public.noqx_pro_subscriptions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  payment_id  text,
  amount_paid numeric     NOT NULL DEFAULT 0,
  started_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz,
  status      text        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','expired','cancelled')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.noqx_pro_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users read own subscription" ON public.noqx_pro_subscriptions;
CREATE POLICY "users read own subscription"
  ON public.noqx_pro_subscriptions FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "service full noqx_pro_subscriptions" ON public.noqx_pro_subscriptions;
CREATE POLICY "service full noqx_pro_subscriptions"
  ON public.noqx_pro_subscriptions FOR ALL USING (auth.role() = 'service_role');
CREATE INDEX IF NOT EXISTS idx_noqx_pro_user
  ON public.noqx_pro_subscriptions(user_id, status);

CREATE TABLE IF NOT EXISTS public.campaigns (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text        NOT NULL,
  description   text,
  subject       text,
  body          text,
  target_emails text[],
  target_roles  text[],
  status        text        NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','scheduled','sent')),
  scheduled_at  timestamptz,
  sent_at       timestamptz,
  created_by    uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service full campaigns" ON public.campaigns;
CREATE POLICY "service full campaigns"
  ON public.campaigns FOR ALL USING (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS public.cart_items (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  menu_item_id uuid        NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  canteen_id   uuid        NOT NULL REFERENCES public.canteens(id) ON DELETE CASCADE,
  quantity     int         NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, menu_item_id)
);
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users manage own cart" ON public.cart_items;
CREATE POLICY "users manage own cart"
  ON public.cart_items FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "service full cart_items" ON public.cart_items;
CREATE POLICY "service full cart_items"
  ON public.cart_items FOR ALL USING (auth.role() = 'service_role');
CREATE INDEX IF NOT EXISTS idx_cart_items_user ON public.cart_items(user_id);

-- ============================================================
-- PHASE 15: Late pickup pending + bin_label / bin_color on orders
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
    EXECUTE $sql$ DO $inner$ BEGIN ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'late_pickup'; EXCEPTION WHEN OTHERS THEN NULL; END $inner$; $sql$;
    EXECUTE $sql$ DO $inner$ BEGIN ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'late_pickup_pending'; EXCEPTION WHEN OTHERS THEN NULL; END $inner$; $sql$;
  END IF;
END $$;

DO $$
DECLARE v_constraint text; v_new_check text;
BEGIN
  SELECT conname INTO v_constraint
  FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'orders' AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%status%'
    AND pg_get_constraintdef(c.oid) LIKE '%placed%'
  LIMIT 1;
  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.orders DROP CONSTRAINT %I', v_constraint);
    v_new_check := $check$(status = ANY (ARRAY[
      'placed','confirmed','preparing','ready_for_placement',
      'placed_in_bin','ready_for_pickup','collected','cancelled',
      'late_pickup','late_pickup_pending','received','ready','completed','grace_bin'
    ]::text[]))$check$;
    EXECUTE format('ALTER TABLE public.orders ADD CONSTRAINT %I CHECK %s', v_constraint, v_new_check);
  END IF;
END $$;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS bin_label text,
  ADD COLUMN IF NOT EXISTS bin_color text;

-- ============================================================
-- PHASE 16: Missing tables (platform_charges, settlement_payments, etc.)
-- ============================================================

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
CREATE POLICY "platform_charges: admin only" ON public.platform_charges FOR ALL USING (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS public.settlement_payments (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  canteen_id   uuid        NOT NULL REFERENCES public.canteens(id) ON DELETE CASCADE,
  amount       numeric     NOT NULL,
  period_start date        NOT NULL,
  period_end   date        NOT NULL,
  status       text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed')),
  notes        text,
  paid_at      timestamptz,
  created_by   uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.settlement_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "settlement_payments: service full" ON public.settlement_payments;
CREATE POLICY "settlement_payments: service full" ON public.settlement_payments FOR ALL USING (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  subject      text        NOT NULL,
  body         text        NOT NULL,
  status       text        NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
  priority     text        NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  assigned_to  uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "support_tickets: service full" ON public.support_tickets;
CREATE POLICY "support_tickets: service full" ON public.support_tickets FOR ALL USING (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS public.waste_reports (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  canteen_id   uuid        NOT NULL REFERENCES public.canteens(id) ON DELETE CASCADE,
  reported_by  uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  item_name    text        NOT NULL,
  quantity     numeric     NOT NULL DEFAULT 0,
  unit         text        NOT NULL DEFAULT 'portions',
  reason       text,
  reported_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.waste_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "waste_reports: service full" ON public.waste_reports;
CREATE POLICY "waste_reports: service full" ON public.waste_reports FOR ALL USING (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS public.device_tokens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token       text        NOT NULL,
  platform    text        NOT NULL DEFAULT 'web' CHECK (platform IN ('web','ios','android')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, token)
);
ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "device_tokens: service full" ON public.device_tokens;
CREATE POLICY "device_tokens: service full" ON public.device_tokens FOR ALL USING (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS public.payments (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              uuid        NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  razorpay_payment_id   text,
  razorpay_order_id     text,
  amount_paise          int,
  refunded_amount_paise int         NOT NULL DEFAULT 0,
  status                text        NOT NULL DEFAULT 'created' CHECK (status IN ('created','authorized','captured','refunded','partial_refund','failed')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (razorpay_payment_id)
);
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payments: service full" ON public.payments;
CREATE POLICY "payments: service full" ON public.payments FOR ALL USING (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS public.notifications (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title          text        NOT NULL,
  body           text        NOT NULL DEFAULT '',
  type           text        NOT NULL DEFAULT 'info',
  recipient_type text        NOT NULL DEFAULT 'all' CHECK (recipient_type IN ('all','canteen','user')),
  recipient_id   uuid,
  target_role    text        CHECK (target_role IN ('all_staff','user','worker','canteen_admin')),
  created_by     uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notifications: service full" ON public.notifications;
CREATE POLICY "notifications: service full" ON public.notifications FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "notifications: users read relevant" ON public.notifications;
CREATE POLICY "notifications: users read relevant" ON public.notifications FOR SELECT
  USING (recipient_type = 'all' OR (recipient_type = 'user' AND recipient_id = auth.uid())
    OR (recipient_type = 'canteen' AND recipient_id = get_my_canteen_id())
    OR get_my_role() IN ('super_admin','co_admin'));

CREATE TABLE IF NOT EXISTS public.notification_reads (
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  read_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, notification_id)
);
ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notification_reads: service full" ON public.notification_reads;
CREATE POLICY "notification_reads: service full" ON public.notification_reads FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "notification_reads: own" ON public.notification_reads;
CREATE POLICY "notification_reads: own" ON public.notification_reads FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON public.notifications(recipient_type, recipient_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_reads_user ON public.notification_reads(user_id);

-- ============================================================
-- PHASE 17: menu_items — is_sold_out, is_hidden
-- ============================================================

ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS is_sold_out boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_hidden   boolean NOT NULL DEFAULT false;

-- ============================================================
-- 2026-05-01: Order cancellation tracking
-- ============================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_by        uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS cancelled_by_role   text,
  ADD COLUMN IF NOT EXISTS cancelled_at        timestamptz,
  ADD COLUMN IF NOT EXISTS refund_id           text,
  ADD COLUMN IF NOT EXISTS refund_status       text;

-- ============================================================
-- 2026-05-02: Per-item cancellation tracking
-- ============================================================

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS cancelled_quantity  int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_at        timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by        uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS cancelled_by_role   text;

ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_cancelled_quantity_check;
ALTER TABLE public.order_items ADD CONSTRAINT order_items_cancelled_quantity_check
  CHECK (cancelled_quantity >= 0 AND cancelled_quantity <= quantity);

CREATE INDEX IF NOT EXISTS idx_order_items_cancelled_at ON public.order_items(cancelled_at) WHERE cancelled_at IS NOT NULL;

-- ============================================================
-- fix_schema_and_auth: co_admin role, security-definer functions, worker auth
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    BEGIN ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'co_admin';
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name ILIKE '%profiles%role%' AND check_clause NOT LIKE '%co_admin%'
  ) THEN
    ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
      CHECK (role IN ('user','canteen_admin','vendor','worker','super_admin','co_admin'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = ''
AS $$ SELECT role::text FROM public.profiles WHERE id = auth.uid(); $$;

CREATE OR REPLACE FUNCTION public.get_my_canteen_id() RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE SET search_path = ''
AS $$ SELECT canteen_id FROM public.profiles WHERE id = auth.uid(); $$;

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, phone)
  VALUES (NEW.id, NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(COALESCE(NEW.email,''),'@',1)),
    NEW.phone)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.verify_order_otp(p_otp text, p_canteen_id uuid)
  RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_order_id uuid; v_bin_id uuid;
BEGIN
  SELECT id, bin_id INTO v_order_id, v_bin_id
  FROM public.orders
  WHERE otp = p_otp AND canteen_id = p_canteen_id AND status = 'ready_for_pickup'
    AND (otp_expires_at IS NULL OR otp_expires_at > now())
  LIMIT 1;
  IF v_order_id IS NULL THEN RAISE EXCEPTION 'Invalid or expired OTP' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.orders SET status = 'collected', updated_at = now() WHERE id = v_order_id;
  IF v_bin_id IS NOT NULL THEN
    UPDATE public.bins SET is_occupied = false, current_order_id = NULL, updated_at = now() WHERE id = v_bin_id;
  END IF;
  RETURN v_order_id;
END; $$;

-- ============================================================
-- normalize_auth_user_tokens: prevent NULL token 500 errors on new user creation
-- ============================================================

CREATE OR REPLACE FUNCTION public.normalize_auth_user_tokens()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  NEW.email_change                := COALESCE(NEW.email_change, '');
  NEW.email_change_token_new      := COALESCE(NEW.email_change_token_new, '');
  NEW.email_change_token_current  := COALESCE(NEW.email_change_token_current, '');
  NEW.email_change_confirm_status := COALESCE(NEW.email_change_confirm_status, 0);
  NEW.phone_change                := COALESCE(NEW.phone_change, '');
  NEW.phone_change_token          := COALESCE(NEW.phone_change_token, '');
  NEW.reauthentication_token      := COALESCE(NEW.reauthentication_token, '');
  NEW.recovery_token              := COALESCE(NEW.recovery_token, '');
  NEW.confirmation_token          := COALESCE(NEW.confirmation_token, '');
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS normalize_tokens_before_insert ON auth.users;
CREATE TRIGGER normalize_tokens_before_insert BEFORE INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.normalize_auth_user_tokens();

UPDATE auth.users SET
  email_change                = COALESCE(email_change, ''),
  email_change_token_new      = COALESCE(email_change_token_new, ''),
  email_change_token_current  = COALESCE(email_change_token_current, ''),
  email_change_confirm_status = COALESCE(email_change_confirm_status, 0),
  phone_change                = COALESCE(phone_change, ''),
  phone_change_token          = COALESCE(phone_change_token, ''),
  reauthentication_token      = COALESCE(reauthentication_token, ''),
  recovery_token              = COALESCE(recovery_token, ''),
  confirmation_token          = COALESCE(confirmation_token, '')
WHERE email_change IS NULL OR email_change_token_new IS NULL OR email_change_token_current IS NULL
   OR email_change_confirm_status IS NULL OR phone_change IS NULL OR phone_change_token IS NULL
   OR reauthentication_token IS NULL OR recovery_token IS NULL OR confirmation_token IS NULL;

-- ============================================================
-- VERIFY SETUP
-- ============================================================
select p.email, p.role, p.name, p.username, u.email_confirmed_at is not null as confirmed
from public.profiles p
join auth.users u on u.id = p.id
where p.email like '%@noqx.test'
order by p.role, p.email;
