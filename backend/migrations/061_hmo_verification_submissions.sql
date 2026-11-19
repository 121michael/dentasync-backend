-- Staff HMO verification is independent of appointment status.
-- A confirmed appointment never implies verified coverage.
-- Apply after 013 paper-gap HMO columns, 052 clinic branches, and 054 patient branch booking:
--   npm run migrate:hmo-verification
-- Reverse only after the previous application code is deployed:
--   npm run migrate:hmo-verification:rollback

ALTER TABLE patient_portal_profiles
  ADD COLUMN IF NOT EXISTS hmo_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hmo_verified_by TEXT,
  ADD COLUMN IF NOT EXISTS hmo_verification_branch_id BIGINT REFERENCES clinic_branches (id);

CREATE TABLE IF NOT EXISTS patient_hmo_submissions (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('profile', 'appointment')),
  appointment_id BIGINT REFERENCES patient_portal_appointments (id) ON DELETE SET NULL,
  hmo_provider TEXT NOT NULL,
  hmo_member_number TEXT NOT NULL,
  hmo_company_name TEXT,
  hmo_birth_date DATE,
  verification_branch_id BIGINT NOT NULL REFERENCES clinic_branches (id),
  verification_status TEXT NOT NULL DEFAULT 'pending_verification'
    CHECK (verification_status IN ('pending_verification', 'verified', 'rejected')),
  verification_result TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TIMESTAMPTZ,
  verified_by TEXT,
  sms_notified_at TIMESTAMPTZ,
  sms_delivery_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS patient_hmo_submissions_branch_status_idx
  ON patient_hmo_submissions (verification_branch_id, verification_status, submitted_at DESC);

CREATE INDEX IF NOT EXISTS patient_hmo_submissions_user_idx
  ON patient_hmo_submissions (user_id, submitted_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS patient_hmo_submissions_pending_coverage_idx
  ON patient_hmo_submissions (
    user_id,
    lower(btrim(hmo_provider)),
    lower(btrim(hmo_member_number))
  )
  WHERE verification_status = 'pending_verification';
