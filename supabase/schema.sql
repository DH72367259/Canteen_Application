-- ============================================================
-- NoQx Canteen App — Supabase PostgreSQL Schema
-- Run this in the Supabase SQL Editor (Project → SQL Editor → New query)
-- ============================================================

-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- CUSTOM TYPES / ENUMS
-- ============================================================
CREATE TYPE user_role       AS ENUM ('user', 'canteen_admin', 'vendor', 'worker', 'super_admin');
CREATE TYPE order_status    AS ENUM (
  'placed', 'confirmed', 'preparing',
  'ready_for_placement', 'placed_in_bin',
  'ready_for_pickup', 'collected', 'cancelled'
);
CREATE TYPE production_type AS ENUM ('batched', 'made_to_order');
CREATE TYPE slot_label      AS ENUM ('morning', 'afternoon', 'evening');
CREATE TYPE reward_tx_type  AS ENUM ('earned', 'redeemed', 'expired');
CREATE TYPE campaign_status AS ENUM ('draft', 'scheduled', 'sent');
CREATE TYPE log_action      AS ENUM ('otp_attempt', 'manual_override', 'staff_action');

-- ============================================================
-- HELPER FUNCTIONS (used in RLS policies)
-- ============================================================
CREATE OR REPLACE FUNCTION get_my_role()
  RETURNS text
  LANGUAGE sql SECURITY DEFINER STABLE
AS $$ SELECT role::text FROM public.profiles WHERE id = auth.uid() $$;

CREATE OR REPLACE FUNCTION get_my_canteen_id()
  RETURNS uuid
  LANGUAGE sql SECURITY DEFINER STABLE
AS $$ SELECT canteen_id FROM public.profiles WHERE id = auth.uid() $$;

-- ============================================================
-- updated_at TRIGGER FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============================================================
-- TABLE: canteens  (created first; profiles FK depends on it)
-- ============================================================
CREATE TABLE public.canteens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  location    text,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_canteens_is_active ON public.canteens(is_active);

CREATE TRIGGER trg_canteens_updated_at
  BEFORE UPDATE ON public.canteens
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- TABLE: profiles  (extends auth.users)
-- ============================================================
CREATE TABLE public.profiles (
  id              uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text,
  email           text,
  phone           text,
  role            user_role   NOT NULL DEFAULT 'user',
  canteen_id      uuid        REFERENCES public.canteens(id) ON DELETE SET NULL,
  wallet_balance  numeric(10, 2) NOT NULL DEFAULT 0.00,
  avatar_url      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_role       ON public.profiles(role);
CREATE INDEX idx_profiles_canteen_id ON public.profiles(canteen_id);

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- TABLE: menu_items
-- ============================================================
CREATE TABLE public.menu_items (
  id                   uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  canteen_id           uuid           NOT NULL REFERENCES public.canteens(id) ON DELETE CASCADE,
  name                 text           NOT NULL,
  description          text,
  price                numeric(10, 2) NOT NULL,
  category             text,
  production_type      production_type NOT NULL DEFAULT 'made_to_order',
  image_url            text,
  is_available         boolean        NOT NULL DEFAULT true,
  is_meal              boolean        NOT NULL DEFAULT false,
  availability_type    text           NOT NULL DEFAULT 'batched_prepared',
  quantity_per_slot    int,
  total_per_day        int,
  cancelled_quantity   int            NOT NULL DEFAULT 0,
  created_at           timestamptz    NOT NULL DEFAULT now(),
  updated_at           timestamptz    NOT NULL DEFAULT now()
);

CREATE INDEX idx_menu_items_canteen_id   ON public.menu_items(canteen_id);
CREATE INDEX idx_menu_items_category     ON public.menu_items(category);
CREATE INDEX idx_menu_items_is_available ON public.menu_items(is_available);

CREATE TRIGGER trg_menu_items_updated_at
  BEFORE UPDATE ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- TABLE: slot_control (Per-canteen dynamic configuration)
-- ============================================================
-- One row per canteen with all configurable capacity & timing settings.
-- All numbers are dynamically derived from max_bins via computed columns.
-- Canteen admins modify this via the "Slot & Bin Control" dashboard.
CREATE TABLE public.slot_control (
  canteen_id            uuid        PRIMARY KEY REFERENCES public.canteens(id) ON DELETE CASCADE,
  max_bins              int         NOT NULL DEFAULT 60 CHECK (max_bins > 0),
  slot_duration_mins    int         NOT NULL DEFAULT 15 CHECK (slot_duration_mins IN (10, 15, 20)),
  morning_start         time        NOT NULL DEFAULT '07:00',
  morning_end           time        NOT NULL DEFAULT '11:00',
  afternoon_start       time        NOT NULL DEFAULT '11:30',
  afternoon_end         time        NOT NULL DEFAULT '17:00',
  evening_start         time        NOT NULL DEFAULT '18:00',
  evening_end           time        NOT NULL DEFAULT '21:30',
  grace_period_mins     int         NOT NULL DEFAULT 10 CHECK (grace_period_mins >= 0),
  extra_bin_fee_paise   int         NOT NULL DEFAULT 200 CHECK (extra_bin_fee_paise >= 0),
  meals_per_bin         int         NOT NULL DEFAULT 2 CHECK (meals_per_bin > 0),
  snacks_per_bin        int         NOT NULL DEFAULT 5 CHECK (snacks_per_bin > 0),
  -- Auto-derived from max_bins (75% rule):
  max_orders_per_slot   int         GENERATED ALWAYS AS (FLOOR(max_bins * 0.75)::int) STORED,
  batched_prepared_cap  int         GENERATED ALWAYS AS (FLOOR(FLOOR(max_bins * 0.75) * 0.70)::int) STORED,
  made_to_order_cap     int         GENERATED ALWAYS AS (FLOOR(max_bins * 0.75)::int - FLOOR(FLOOR(max_bins * 0.75) * 0.70)::int) STORED,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_slot_control_updated_at
  BEFORE UPDATE ON public.slot_control
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- TABLE: time_slots
-- ============================================================
CREATE TABLE public.time_slots (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  canteen_id        uuid        NOT NULL REFERENCES public.canteens(id) ON DELETE CASCADE,
  slot_name         slot_label  NOT NULL,
  start_time        time        NOT NULL,
  end_time          time        NOT NULL,
  duration_minutes  int         NOT NULL DEFAULT 15,
  is_active         boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (canteen_id, slot_name)
);

CREATE INDEX idx_time_slots_canteen_id ON public.time_slots(canteen_id);

CREATE TRIGGER trg_time_slots_updated_at
  BEFORE UPDATE ON public.time_slots
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- TABLE: bins
-- ============================================================
CREATE TABLE public.bins (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  canteen_id        uuid        NOT NULL REFERENCES public.canteens(id) ON DELETE CASCADE,
  bin_code          text        NOT NULL,
  color             text,
  zone_color        text,
  bin_number        int,
  is_occupied       boolean     NOT NULL DEFAULT false,
  current_order_id  uuid,       -- FK added after orders table
  assigned_order_id uuid,
  status            text        NOT NULL DEFAULT 'empty' CHECK (status IN (
    'empty','preparing','placed','picked','late_pickup','grace_bin','reserved','occupied','disabled'
  )),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (canteen_id, bin_code)
);

CREATE INDEX idx_bins_canteen_id       ON public.bins(canteen_id);
CREATE INDEX idx_bins_is_occupied      ON public.bins(is_occupied);
CREATE INDEX idx_bins_zone_color       ON public.bins(canteen_id, zone_color, bin_number);
CREATE INDEX idx_bins_assigned_order   ON public.bins(assigned_order_id);

CREATE TRIGGER trg_bins_updated_at
  BEFORE UPDATE ON public.bins
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- TABLE: orders
-- ============================================================
CREATE TABLE public.orders (
  id                    uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid           NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  canteen_id            uuid           NOT NULL REFERENCES public.canteens(id) ON DELETE RESTRICT,
  slot_id               uuid           REFERENCES public.time_slots(id) ON DELETE SET NULL,
  bin_id                uuid           REFERENCES public.bins(id) ON DELETE SET NULL,
  status                order_status   NOT NULL DEFAULT 'placed',
  total_amount          numeric(10, 2) NOT NULL,
  otp                   text,
  otp_expires_at        timestamptz,
  payment_id            text,
  payment_status        text           DEFAULT 'pending',
  notes                 text,
  slot_label            text,
  extra_bin_fee_paise   int            NOT NULL DEFAULT 0 CHECK (extra_bin_fee_paise >= 0),
  bin_count             int            NOT NULL DEFAULT 1 CHECK (bin_count >= 1),
  created_at            timestamptz    NOT NULL DEFAULT now(),
  updated_at            timestamptz    NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_user_id    ON public.orders(user_id);
CREATE INDEX idx_orders_canteen_id ON public.orders(canteen_id);
CREATE INDEX idx_orders_status     ON public.orders(status);
CREATE INDEX idx_orders_created_at ON public.orders(created_at DESC);
CREATE INDEX idx_orders_slot_cap   ON public.orders(canteen_id, slot_label, created_at)
  WHERE status NOT IN ('cancelled', 'failed', 'refunded');

CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Circular FKs: bins.current_order_id → orders, bins.assigned_order_id → orders
ALTER TABLE public.bins
  ADD CONSTRAINT fk_bins_current_order
  FOREIGN KEY (current_order_id) REFERENCES public.orders(id) ON DELETE SET NULL;

ALTER TABLE public.bins
  ADD CONSTRAINT fk_bins_assigned_order
  FOREIGN KEY (assigned_order_id) REFERENCES public.orders(id) ON DELETE SET NULL;

-- ============================================================
-- TABLE: order_bins (Multi-bin order assignments)
-- ============================================================
CREATE TABLE public.order_bins (
  id              uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid           NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  bin_id          uuid           REFERENCES public.bins(id) ON DELETE SET NULL,
  bin_index       int            NOT NULL CHECK (bin_index >= 1),
  bin_code        text,
  bin_color       text,
  items           jsonb          NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz    NOT NULL DEFAULT now(),
  UNIQUE (order_id, bin_index)
);

CREATE INDEX idx_order_bins_order_id ON public.order_bins(order_id);
CREATE INDEX idx_order_bins_bin_id   ON public.order_bins(bin_id);

-- ============================================================
-- TABLE: order_items
-- ============================================================
CREATE TABLE public.order_items (
  id            uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid           NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  menu_item_id  uuid           NOT NULL REFERENCES public.menu_items(id) ON DELETE RESTRICT,
  quantity      int            NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price    numeric(10, 2) NOT NULL,
  created_at    timestamptz    NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_items_order_id ON public.order_items(order_id);

-- ============================================================
-- TABLE: rewards  (per-user wallet balance + expiry tracking)
-- ============================================================
CREATE TABLE public.rewards (
  id              uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid           NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  points_balance  numeric(10, 2) NOT NULL DEFAULT 0.00,
  last_earned_at  timestamptz,
  expires_at      timestamptz,   -- 7 days from last earn
  created_at      timestamptz    NOT NULL DEFAULT now(),
  updated_at      timestamptz    NOT NULL DEFAULT now()
);

CREATE INDEX idx_rewards_user_id   ON public.rewards(user_id);
CREATE INDEX idx_rewards_expires_at ON public.rewards(expires_at);

CREATE TRIGGER trg_rewards_updated_at
  BEFORE UPDATE ON public.rewards
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- TABLE: reward_transactions
-- ============================================================
CREATE TABLE public.reward_transactions (
  id          uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid           NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type        reward_tx_type NOT NULL,
  points      numeric(10, 2) NOT NULL,
  order_id    uuid           REFERENCES public.orders(id) ON DELETE SET NULL,
  reason      text,
  expires_at  timestamptz,
  created_at  timestamptz    NOT NULL DEFAULT now()
);

CREATE INDEX idx_reward_tx_user_id  ON public.reward_transactions(user_id);
CREATE INDEX idx_reward_tx_order_id ON public.reward_transactions(order_id);
CREATE INDEX idx_reward_tx_type     ON public.reward_transactions(type);

-- ============================================================
-- TABLE: campaigns  (super admin marketing)
-- ============================================================
CREATE TABLE public.campaigns (
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

CREATE INDEX idx_campaigns_status     ON public.campaigns(status);
CREATE INDEX idx_campaigns_created_by ON public.campaigns(created_by);

CREATE TRIGGER trg_campaigns_updated_at
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- TABLE: logs  (OTP attempts, manual overrides, staff actions)
-- ============================================================
CREATE TABLE public.logs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type  log_action  NOT NULL,
  actor_id     uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_id    uuid,
  target_type  text,
  metadata     jsonb       DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_logs_actor_id    ON public.logs(actor_id);
CREATE INDEX idx_logs_action_type ON public.logs(action_type);
CREATE INDEX idx_logs_target_id   ON public.logs(target_id);
CREATE INDEX idx_logs_created_at  ON public.logs(created_at DESC);

-- ============================================================
-- TABLE: slots_override  (daily capacity overrides)
-- ============================================================
CREATE TABLE public.slots_override (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id        uuid        NOT NULL REFERENCES public.time_slots(id) ON DELETE CASCADE,
  override_date  date        NOT NULL,
  max_orders     int,
  is_active      boolean,
  reason         text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slot_id, override_date)
);

CREATE INDEX idx_slots_override_slot_id ON public.slots_override(slot_id);
CREATE INDEX idx_slots_override_date    ON public.slots_override(override_date);

CREATE TRIGGER trg_slots_override_updated_at
  BEFORE UPDATE ON public.slots_override
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- TRIGGER: handle_new_user
-- Auto-inserts a row into profiles when a new auth.users row is created
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, phone)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(COALESCE(NEW.email, ''), '@', 1)
    ),
    NEW.phone
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- FUNCTION: increment_wallet_balance
-- Atomically updates profiles.wallet_balance
-- ============================================================
CREATE OR REPLACE FUNCTION increment_wallet_balance(p_user_id uuid, p_delta numeric)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.profiles
     SET wallet_balance = wallet_balance + p_delta,
         updated_at     = now()
   WHERE id = p_user_id;
END;
$$;

-- ============================================================
-- FUNCTION: verify_order_otp
-- Validates OTP, marks order collected, frees bin
-- ============================================================
CREATE OR REPLACE FUNCTION verify_order_otp(p_otp text, p_canteen_id uuid)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  v_order_id uuid;
  v_bin_id   uuid;
BEGIN
  -- Find matching order with a valid, unexpired OTP
  SELECT id, bin_id
    INTO v_order_id, v_bin_id
    FROM public.orders
   WHERE otp        = p_otp
     AND canteen_id = p_canteen_id
     AND status     = 'ready_for_pickup'
     AND (otp_expires_at IS NULL OR otp_expires_at > now())
   LIMIT 1;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired OTP' USING ERRCODE = 'P0001';
  END IF;

  -- Mark order as collected
  UPDATE public.orders
     SET status     = 'collected',
         updated_at = now()
   WHERE id = v_order_id;

  -- Free the bin
  IF v_bin_id IS NOT NULL THEN
    UPDATE public.bins
       SET is_occupied      = false,
           current_order_id = NULL,
           updated_at       = now()
     WHERE id = v_bin_id;
  END IF;

  -- Log the successful OTP verification
  INSERT INTO public.logs (action_type, target_id, target_type, metadata)
  VALUES (
    'otp_attempt',
    v_order_id,
    'order',
    jsonb_build_object('status', 'success', 'canteen_id', p_canteen_id)
  );

  RETURN v_order_id;
END;
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
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

-- ---- profiles ----
CREATE POLICY "profiles: user reads own"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id OR get_my_role() IN ('super_admin', 'canteen_admin'));

CREATE POLICY "profiles: user updates own"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles: super_admin all"
  ON public.profiles FOR ALL
  USING (get_my_role() = 'super_admin');

-- ---- canteens ----
CREATE POLICY "canteens: anyone reads active"
  ON public.canteens FOR SELECT
  USING (is_active = true OR get_my_role() IN ('super_admin', 'canteen_admin', 'vendor', 'worker'));

CREATE POLICY "canteens: canteen_admin updates own"
  ON public.canteens FOR UPDATE
  USING (id = get_my_canteen_id() AND get_my_role() = 'canteen_admin');

CREATE POLICY "canteens: super_admin all"
  ON public.canteens FOR ALL
  USING (get_my_role() = 'super_admin');

-- ---- menu_items ----
CREATE POLICY "menu_items: anyone reads available"
  ON public.menu_items FOR SELECT
  USING (is_available = true OR get_my_role() IN ('super_admin', 'canteen_admin', 'vendor'));

CREATE POLICY "menu_items: staff manage own canteen"
  ON public.menu_items FOR ALL
  USING (canteen_id = get_my_canteen_id() AND get_my_role() IN ('canteen_admin', 'vendor'));

CREATE POLICY "menu_items: super_admin all"
  ON public.menu_items FOR ALL
  USING (get_my_role() = 'super_admin');

-- ---- slot_control (dynamic per-canteen configuration) ----
CREATE POLICY "slot_control: service role all"
  ON public.slot_control FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "slot_control: canteen_admin reads & writes own"
  ON public.slot_control FOR SELECT
  USING (canteen_id = get_my_canteen_id() OR get_my_role() = 'super_admin');

CREATE POLICY "slot_control: canteen_admin updates own"
  ON public.slot_control FOR UPDATE
  USING (
    (canteen_id = get_my_canteen_id() AND get_my_role() = 'canteen_admin')
    OR get_my_role() = 'super_admin'
  );

-- ---- time_slots ----
CREATE POLICY "time_slots: anyone reads"
  ON public.time_slots FOR SELECT
  USING (true);

CREATE POLICY "time_slots: canteen_admin manages own"
  ON public.time_slots FOR ALL
  USING (canteen_id = get_my_canteen_id() AND get_my_role() IN ('canteen_admin'));

CREATE POLICY "time_slots: super_admin all"
  ON public.time_slots FOR ALL
  USING (get_my_role() = 'super_admin');

-- ---- bins ----
CREATE POLICY "bins: staff reads"
  ON public.bins FOR SELECT
  USING (
    get_my_role() IN ('super_admin', 'canteen_admin', 'worker', 'vendor')
    OR canteen_id = get_my_canteen_id()
  );

CREATE POLICY "bins: staff manages own canteen"
  ON public.bins FOR ALL
  USING (canteen_id = get_my_canteen_id() AND get_my_role() IN ('canteen_admin', 'worker'));

CREATE POLICY "bins: super_admin all"
  ON public.bins FOR ALL
  USING (get_my_role() = 'super_admin');

-- ---- orders ----
CREATE POLICY "orders: user reads own"
  ON public.orders FOR SELECT
  USING (
    user_id = auth.uid()
    OR get_my_role() IN ('super_admin', 'canteen_admin', 'worker', 'vendor')
  );

CREATE POLICY "orders: user creates own"
  ON public.orders FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "orders: staff updates own canteen"
  ON public.orders FOR UPDATE
  USING (
    canteen_id = get_my_canteen_id()
    AND get_my_role() IN ('canteen_admin', 'worker', 'vendor')
  );

CREATE POLICY "orders: super_admin all"
  ON public.orders FOR ALL
  USING (get_my_role() = 'super_admin');

-- ---- order_bins ----
CREATE POLICY "order_bins: user reads own"
  ON public.order_bins FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_bins.order_id
        AND (
          o.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.role IN ('canteen_admin', 'vendor', 'worker', 'super_admin', 'co_admin')
          )
        )
    )
  );

-- ---- order_items ----
CREATE POLICY "order_items: user reads own"
  ON public.order_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.orders
       WHERE orders.id      = order_items.order_id
         AND (
           orders.user_id = auth.uid()
           OR get_my_role() IN ('super_admin', 'canteen_admin', 'worker', 'vendor')
         )
    )
  );

CREATE POLICY "order_items: user inserts for own order"
  ON public.order_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.orders
       WHERE orders.id      = order_items.order_id
         AND orders.user_id = auth.uid()
    )
  );

-- ---- rewards ----
CREATE POLICY "rewards: user reads own"
  ON public.rewards FOR SELECT
  USING (user_id = auth.uid() OR get_my_role() = 'super_admin');

CREATE POLICY "rewards: super_admin all"
  ON public.rewards FOR ALL
  USING (get_my_role() = 'super_admin');

-- ---- reward_transactions ----
CREATE POLICY "reward_tx: user reads own"
  ON public.reward_transactions FOR SELECT
  USING (user_id = auth.uid() OR get_my_role() = 'super_admin');

CREATE POLICY "reward_tx: super_admin all"
  ON public.reward_transactions FOR ALL
  USING (get_my_role() = 'super_admin');

-- ---- campaigns ----
CREATE POLICY "campaigns: super_admin all"
  ON public.campaigns FOR ALL
  USING (get_my_role() = 'super_admin');

-- ---- logs ----
CREATE POLICY "logs: staff reads"
  ON public.logs FOR SELECT
  USING (get_my_role() IN ('super_admin', 'canteen_admin'));

CREATE POLICY "logs: anyone inserts"
  ON public.logs FOR INSERT
  WITH CHECK (true);

-- ---- slots_override ----
CREATE POLICY "slots_override: anyone reads"
  ON public.slots_override FOR SELECT
  USING (true);

CREATE POLICY "slots_override: canteen_admin manages"
  ON public.slots_override FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.time_slots
       WHERE time_slots.id         = slots_override.slot_id
         AND time_slots.canteen_id = get_my_canteen_id()
    )
    AND get_my_role() = 'canteen_admin'
  );

CREATE POLICY "slots_override: super_admin all"
  ON public.slots_override FOR ALL
  USING (get_my_role() = 'super_admin');

-- ============================================================
-- REALTIME  (uncomment to enable live updates)
-- ============================================================
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.bins;
