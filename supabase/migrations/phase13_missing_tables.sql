-- ============================================================
-- Phase 13: Document + create missing reference tables
--
-- noqx_pro_subscriptions: already exists in production (was created
--   manually). CREATE TABLE IF NOT EXISTS is a no-op for it — this
--   entry just keeps the schema tracked in migrations.
-- campaigns + cart_items: referenced by admin user-deletion cleanup
--   (try/catch, fail-safe). Creating them properly so no silent errors.
-- Idempotent: safe to re-run.
-- ============================================================

-- 1. Pro subscriptions table (already exists in prod — idempotent) ─────────
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

CREATE POLICY IF NOT EXISTS "users read own subscription"
  ON public.noqx_pro_subscriptions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "service full noqx_pro_subscriptions"
  ON public.noqx_pro_subscriptions FOR ALL
  USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_noqx_pro_user
  ON public.noqx_pro_subscriptions(user_id, status);

-- 2. Campaigns (super-admin broadcast messages) ────────────────────────────
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

CREATE POLICY IF NOT EXISTS "service full campaigns"
  ON public.campaigns FOR ALL
  USING (auth.role() = 'service_role');

-- 3. Cart items (persistent cart, cleaned up on user deletion) ────────────
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

CREATE POLICY IF NOT EXISTS "users manage own cart"
  ON public.cart_items FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "service full cart_items"
  ON public.cart_items FOR ALL
  USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_cart_items_user
  ON public.cart_items(user_id);
