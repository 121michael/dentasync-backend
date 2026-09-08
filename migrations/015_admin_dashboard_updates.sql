-- Admin dashboard updates:
-- 1) Track when account status last changed (for rejected-list ordering).
-- 2) Treatment history amounts for admin view/edit.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;

UPDATE users
SET status_changed_at = COALESCE(status_changed_at, created_at, CURRENT_TIMESTAMP)
WHERE status_changed_at IS NULL
  AND LOWER(COALESCE(status, '')) IN ('rejected', 'active', 'pending', 'suspended', 'inactive');

CREATE INDEX IF NOT EXISTS users_rejected_status_changed_idx
  ON users (status_changed_at ASC)
  WHERE LOWER(COALESCE(status, '')) = 'rejected'
    AND COALESCE(is_archived, FALSE) = FALSE;

ALTER TABLE clinic_patient_treatments
  ADD COLUMN IF NOT EXISTS amount_charged NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS appointment_id BIGINT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_by TEXT;

ALTER TABLE clinic_patient_treatments
  DROP CONSTRAINT IF EXISTS clinic_patient_treatments_amount_charged_nonneg;

ALTER TABLE clinic_patient_treatments
  ADD CONSTRAINT clinic_patient_treatments_amount_charged_nonneg
  CHECK (amount_charged >= 0);

ALTER TABLE clinic_patient_treatments
  DROP CONSTRAINT IF EXISTS clinic_patient_treatments_amount_paid_nonneg;

ALTER TABLE clinic_patient_treatments
  ADD CONSTRAINT clinic_patient_treatments_amount_paid_nonneg
  CHECK (amount_paid >= 0);
