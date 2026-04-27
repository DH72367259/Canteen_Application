-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Prevent "Database error querying schema" on new user creation
--
-- Root cause: Supabase's auth Go-server expects auth.users token columns
-- (email_change, recovery_token, phone_change, etc.) to be empty strings,
-- not NULL. Some auth.admin.createUser calls leave these as NULL, causing
-- 500 errors on subsequent /token calls.
--
-- Fix: BEFORE INSERT trigger on auth.users that COALESCEs NULL → '' for all
-- string-token columns. This auto-heals every new user, including ones
-- created via the admin dashboard.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.normalize_auth_user_tokens()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
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
END;
$$;

DROP TRIGGER IF EXISTS normalize_tokens_before_insert ON auth.users;
CREATE TRIGGER normalize_tokens_before_insert
  BEFORE INSERT OR UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_auth_user_tokens();

-- One-time backfill for any existing users with NULL token columns
UPDATE auth.users
SET
  email_change                = COALESCE(email_change, ''),
  email_change_token_new      = COALESCE(email_change_token_new, ''),
  email_change_token_current  = COALESCE(email_change_token_current, ''),
  email_change_confirm_status = COALESCE(email_change_confirm_status, 0),
  phone_change                = COALESCE(phone_change, ''),
  phone_change_token          = COALESCE(phone_change_token, ''),
  reauthentication_token      = COALESCE(reauthentication_token, ''),
  recovery_token              = COALESCE(recovery_token, ''),
  confirmation_token          = COALESCE(confirmation_token, '')
WHERE email_change IS NULL
   OR email_change_token_new IS NULL
   OR email_change_token_current IS NULL
   OR email_change_confirm_status IS NULL
   OR phone_change IS NULL
   OR phone_change_token IS NULL
   OR reauthentication_token IS NULL
   OR recovery_token IS NULL
   OR confirmation_token IS NULL;
