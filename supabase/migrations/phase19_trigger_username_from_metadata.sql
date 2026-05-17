-- ============================================================
-- Phase 19: handle_new_user — extract username from metadata
--
-- Previously the trigger inserted profiles without username.
-- Admin-created users (Supabase Dashboard or POST /api/admin/users)
-- that include username in user_metadata now get it persisted.
--
-- Idempotent: safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
DECLARE
  v_username text;
BEGIN
  -- Extract username from metadata if provided (admin-created users)
  v_username := NULLIF(TRIM(LOWER(NEW.raw_user_meta_data->>'username')), '');

  INSERT INTO public.profiles (id, email, name, phone, username)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(COALESCE(NEW.email, ''), '@', 1)
    ),
    NEW.phone,
    v_username
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
