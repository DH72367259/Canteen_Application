-- ============================================================
-- Phase 10: Add username field for worker/staff login
--
-- Workers and staff need a way to log in with a username
-- (e.g., "chef1", "worker_a") instead of email. This field
-- stores the unique username per user profile.
--
-- Idempotent: safe to re-run.
-- ============================================================

-- Add username column if it doesn't exist
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS username text UNIQUE;

-- Create index for fast username lookups during login
CREATE INDEX IF NOT EXISTS idx_profiles_username
  ON public.profiles(username)
  WHERE username IS NOT NULL;

-- Grant select on profiles to anon for auth lookups
GRANT SELECT (username, email) ON public.profiles TO anon;
