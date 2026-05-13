-- Phase 10: SMS OTP table for Fast2SMS login flow
-- Stores hashed OTP codes for phone-based login (replaces Twilio Verify)

CREATE TABLE IF NOT EXISTS public.sms_otp_codes (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  phone       TEXT        NOT NULL,
  code_hash   TEXT        NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
  attempts    INT         NOT NULL DEFAULT 0,
  verified_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_otp_phone_expires
  ON public.sms_otp_codes(phone, expires_at DESC);

ALTER TABLE public.sms_otp_codes ENABLE ROW LEVEL SECURITY;

-- Only the service role (server-side) can read/write OTP codes
CREATE POLICY "service_role_only" ON public.sms_otp_codes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Auto-delete expired codes older than 1 hour to keep the table small
CREATE OR REPLACE FUNCTION delete_expired_sms_otps() RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM public.sms_otp_codes
  WHERE expires_at < NOW() - INTERVAL '1 hour';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cleanup_sms_otps ON public.sms_otp_codes;
CREATE TRIGGER trg_cleanup_sms_otps
  AFTER INSERT ON public.sms_otp_codes
  EXECUTE FUNCTION delete_expired_sms_otps();
