CREATE TABLE IF NOT EXISTS password_reset_requests (
  request_id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  CONSTRAINT password_reset_requests_valid_expiry
    CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS password_reset_requests_one_active_per_user
  ON password_reset_requests (user_id)
  WHERE used_at IS NULL AND invalidated_at IS NULL;

CREATE INDEX IF NOT EXISTS password_reset_requests_expiry_index
  ON password_reset_requests (expires_at);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
