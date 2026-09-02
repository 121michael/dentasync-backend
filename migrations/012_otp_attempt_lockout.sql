-- Track failed OTP guesses and temporary lockouts per request.
ALTER TABLE otp_verification_requests
  ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE otp_verification_requests
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
