-- Temporary staff-generated walk-in QR check-in sessions.
-- Tokens contain no patient PII; patients authenticate separately to redeem.

CREATE TABLE IF NOT EXISTS staff_walkin_qr_sessions (
  id BIGSERIAL PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  created_by_user_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS staff_walkin_qr_sessions_active_idx
  ON staff_walkin_qr_sessions (expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS staff_walkin_qr_redemptions (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES staff_walkin_qr_sessions(id) ON DELETE CASCADE,
  patient_user_id TEXT NOT NULL,
  appointment_id BIGINT,
  queue_entry_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (session_id, patient_user_id)
);

CREATE INDEX IF NOT EXISTS staff_walkin_qr_redemptions_patient_idx
  ON staff_walkin_qr_redemptions (patient_user_id, created_at DESC);
