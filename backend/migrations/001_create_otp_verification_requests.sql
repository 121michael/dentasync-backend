-- OTP request records are deliberately separate from the legacy `otps` table.
-- A request belongs to one account and is consumed atomically after a successful
-- verification. All timestamps use TIMESTAMPTZ so PostgreSQL compares them
-- against CURRENT_TIMESTAMP consistently.

CREATE TABLE IF NOT EXISTS otp_verification_requests (
  request_id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  CONSTRAINT otp_verification_requests_valid_expiry
    CHECK (expires_at > created_at)
);

-- The application invalidates the prior active request before creating a new
-- one. This index also protects that invariant if another writer is introduced.
CREATE UNIQUE INDEX IF NOT EXISTS otp_verification_requests_one_active_per_user
  ON otp_verification_requests (user_id)
  WHERE used_at IS NULL AND invalidated_at IS NULL;

CREATE INDEX IF NOT EXISTS otp_verification_requests_expiry_index
  ON otp_verification_requests (expires_at);
