DROP INDEX IF EXISTS clinic_patient_records_hmo_status_idx;

ALTER TABLE patient_portal_profiles
  DROP COLUMN IF EXISTS hmo_verification_status;

ALTER TABLE clinic_patient_records
  DROP COLUMN IF EXISTS hmo_verification_status,
  DROP COLUMN IF EXISTS hmo_member_number,
  DROP COLUMN IF EXISTS hmo_provider;
