-- In-account dependents: pending profiles under a guardian login (no separate password).
-- Existing linked accounts stay approved and keep their own user rows.

ALTER TABLE patient_portal_dependents
  ALTER COLUMN dependent_user_id DROP NOT NULL;

ALTER TABLE patient_portal_dependents
  DROP CONSTRAINT IF EXISTS patient_portal_dependents_check;

ALTER TABLE patient_portal_dependents
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS middle_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT,
  ADD COLUMN IF NOT EXISTS date_of_birth DATE,
  ADD COLUMN IF NOT EXISTS gender TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS patient_category TEXT,
  ADD COLUMN IF NOT EXISTS approval_status TEXT,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

UPDATE patient_portal_dependents
SET approval_status = COALESCE(NULLIF(LOWER(approval_status), ''), 'approved')
WHERE dependent_user_id IS NOT NULL;

UPDATE patient_portal_dependents
SET approval_status = COALESCE(NULLIF(LOWER(approval_status), ''), 'pending')
WHERE dependent_user_id IS NULL;

UPDATE patient_portal_dependents
SET submitted_at = COALESCE(submitted_at, created_at, CURRENT_TIMESTAMP);

ALTER TABLE patient_portal_dependents
  ALTER COLUMN approval_status SET DEFAULT 'pending';

ALTER TABLE patient_portal_dependents
  ALTER COLUMN approval_status SET NOT NULL;

ALTER TABLE patient_portal_dependents
  ALTER COLUMN submitted_at SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE patient_portal_dependents
  ALTER COLUMN submitted_at SET NOT NULL;

ALTER TABLE patient_portal_dependents
  DROP CONSTRAINT IF EXISTS patient_portal_dependents_approval_status_check;

ALTER TABLE patient_portal_dependents
  ADD CONSTRAINT patient_portal_dependents_approval_status_check
  CHECK (LOWER(approval_status) IN ('pending', 'approved', 'rejected'));

ALTER TABLE patient_portal_dependents
  DROP CONSTRAINT IF EXISTS patient_portal_dependents_approved_user_check;

ALTER TABLE patient_portal_dependents
  ADD CONSTRAINT patient_portal_dependents_approved_user_check
  CHECK (LOWER(approval_status) <> 'approved' OR dependent_user_id IS NOT NULL);

ALTER TABLE patient_portal_dependents
  DROP CONSTRAINT IF EXISTS patient_portal_dependents_self_check;

ALTER TABLE patient_portal_dependents
  ADD CONSTRAINT patient_portal_dependents_self_check
  CHECK (dependent_user_id IS NULL OR guardian_user_id <> dependent_user_id);

CREATE INDEX IF NOT EXISTS patient_portal_dependents_approval_idx
  ON patient_portal_dependents (approval_status, submitted_at DESC);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS managed_by_user_id TEXT;

CREATE INDEX IF NOT EXISTS users_managed_by_idx
  ON users (managed_by_user_id)
  WHERE managed_by_user_id IS NOT NULL;

COMMENT ON COLUMN patient_portal_dependents.approval_status IS
  'pending | approved | rejected — Admin must approve before the dependent is an active patient.';
COMMENT ON COLUMN users.managed_by_user_id IS
  'Guardian account that owns this managed dependent patient record (no separate login).';
