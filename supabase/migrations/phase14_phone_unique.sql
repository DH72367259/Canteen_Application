-- Phase 14: Unique phone constraint on profiles
-- Prevents two accounts from sharing the same Indian mobile number.
-- NULL phones are allowed (staff accounts without phone numbers).

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_phone_unique
  ON public.profiles (phone)
  WHERE phone IS NOT NULL AND phone <> '';
