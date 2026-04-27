-- ============================================================
-- MIGRATION: Fix Security-Definer search_path, add co_admin role,
--            ensure notifications tables, and fix worker auth
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- ── 1. Add co_admin to user_role ENUM (if ENUM type exists) ──────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    BEGIN
      ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'co_admin';
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

-- ── 2. If profiles.role uses a TEXT CHECK constraint, widen it ────────────
DO $$
BEGIN
  -- Drop the old constraint if it doesn't include co_admin
  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name ILIKE '%profiles%role%'
      AND check_clause NOT LIKE '%co_admin%'
  ) THEN
    ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_role_check
      CHECK (role IN ('user','canteen_admin','vendor','worker','super_admin','co_admin'));
  END IF;
END $$;

-- ── 3. Fix get_my_role — add SET search_path = '' ─────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_role()
  RETURNS text
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = ''
AS $$
  SELECT role::text FROM public.profiles WHERE id = auth.uid();
$$;

-- ── 4. Fix get_my_canteen_id — add SET search_path = '' ───────────────────
CREATE OR REPLACE FUNCTION public.get_my_canteen_id()
  RETURNS uuid
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = ''
AS $$
  SELECT canteen_id FROM public.profiles WHERE id = auth.uid();
$$;

-- ── 5. Fix handle_new_user — add SET search_path = '' ─────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
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
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Re-attach trigger (safe: DROP IF EXISTS + CREATE)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── 6. Fix verify_order_otp — add SET search_path = '' ───────────────────
CREATE OR REPLACE FUNCTION public.verify_order_otp(p_otp text, p_canteen_id uuid)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
DECLARE
  v_order_id uuid;
  v_bin_id   uuid;
BEGIN
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

  UPDATE public.orders
     SET status     = 'collected',
         updated_at = now()
   WHERE id = v_order_id;

  IF v_bin_id IS NOT NULL THEN
    UPDATE public.bins
       SET is_occupied      = false,
           current_order_id = NULL,
           updated_at       = now()
     WHERE id = v_bin_id;
  END IF;

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

-- ── 7. Fix increment_wallet_balance — add SET search_path = '' ──────────
CREATE OR REPLACE FUNCTION public.increment_wallet_balance(
  p_user_id uuid,
  p_amount  numeric
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
BEGIN
  UPDATE public.profiles
     SET wallet_balance = wallet_balance + p_amount
   WHERE id = p_user_id;
END;
$$;

-- ── 8. Notifications tables (idempotent) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title          text        NOT NULL,
  body           text        NOT NULL DEFAULT '',
  type           text        NOT NULL DEFAULT 'info',
  recipient_type text        NOT NULL DEFAULT 'all'
                             CHECK (recipient_type IN ('all', 'canteen', 'user')),
  recipient_id   uuid,
  created_by     uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notification_reads (
  user_id         uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notification_id uuid        NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  read_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, notification_id)
);

-- Enable RLS
ALTER TABLE public.notifications       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_reads  ENABLE ROW LEVEL SECURITY;

-- Policies (idempotent: DROP then CREATE)
DROP POLICY IF EXISTS "notifications: service full" ON public.notifications;
CREATE POLICY "notifications: service full"
  ON public.notifications FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "notifications: users read relevant" ON public.notifications;
CREATE POLICY "notifications: users read relevant"
  ON public.notifications FOR SELECT
  USING (
    recipient_type = 'all'
    OR (recipient_type = 'user' AND recipient_id = auth.uid())
    OR (
      recipient_type = 'canteen'
      AND recipient_id = get_my_canteen_id()
    )
    OR get_my_role() IN ('super_admin', 'co_admin')
  );

DROP POLICY IF EXISTS "notification_reads: service full" ON public.notification_reads;
CREATE POLICY "notification_reads: service full"
  ON public.notification_reads FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "notification_reads: own" ON public.notification_reads;
CREATE POLICY "notification_reads: own"
  ON public.notification_reads FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── 9. FUNCTION: recreate_worker_user ─────────────────────────────────────
-- Deletes the broken worker user (if any) and creates a new profile row.
-- The actual auth.users entry must be created via Admin API (see README).
-- This function just ensures the profile row is correct.
CREATE OR REPLACE FUNCTION public.ensure_worker_profile(
  p_email    text,
  p_name     text,
  p_canteen_id uuid DEFAULT NULL
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
DECLARE
  v_uid uuid;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE email = p_email LIMIT 1;
  IF v_uid IS NULL THEN
    RETURN 'AUTH_USER_NOT_FOUND: Create auth user via Admin API first';
  END IF;

  INSERT INTO public.profiles (id, email, name, role, canteen_id)
  VALUES (v_uid, p_email, p_name, 'worker', p_canteen_id)
  ON CONFLICT (id) DO UPDATE
    SET role = 'worker',
        canteen_id = COALESCE(p_canteen_id, public.profiles.canteen_id),
        name = p_name;

  RETURN 'OK:' || v_uid::text;
END;
$$;

-- ── 10. Indexes for new tables ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_notifications_recipient
  ON public.notifications (recipient_type, recipient_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at
  ON public.notifications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_reads_user
  ON public.notification_reads (user_id);
