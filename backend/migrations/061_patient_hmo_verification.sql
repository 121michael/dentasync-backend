-- Patient-level HMO verification shared by Staff Dashboard, Staff Patient Records,
-- and Dentist Patient Records. Appointment rows stay in sync for the same patient.

ALTER TABLE clinic_patient_records
  ADD COLUMN IF NOT EXISTS hmo_provider TEXT,
  ADD COLUMN IF NOT EXISTS hmo_member_number TEXT,
  ADD COLUMN IF NOT EXISTS hmo_verification_status TEXT NOT NULL DEFAULT 'not_applicable';

ALTER TABLE patient_portal_profiles
  ADD COLUMN IF NOT EXISTS hmo_verification_status TEXT NOT NULL DEFAULT 'not_applicable';

CREATE INDEX IF NOT EXISTS clinic_patient_records_hmo_status_idx
  ON clinic_patient_records (hmo_verification_status);
