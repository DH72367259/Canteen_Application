-- ============================================================
-- Phase 5: Push-notification device tokens (Capacitor mobile shell)
-- ============================================================
-- One row per (user_id, token) so re-launches don't duplicate. Backend
-- targets these to send push on order-ready / refund-processed.
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.device_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token         text NOT NULL,
  platform      text NOT NULL CHECK (platform IN ('ios','android','web')),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON public.device_tokens(user_id);

ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS device_tokens_owner ON public.device_tokens;
CREATE POLICY device_tokens_owner ON public.device_tokens
  FOR SELECT USING (user_id = auth.uid());

-- Inserts/updates always go through the service role from the API endpoint,
-- so no INSERT policy is needed here (RLS denies by default for anon/auth).
