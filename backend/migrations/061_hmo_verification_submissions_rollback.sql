DROP INDEX IF EXISTS patient_hmo_submissions_pending_coverage_idx;
DROP INDEX IF EXISTS patient_hmo_submissions_user_idx;
DROP INDEX IF EXISTS patient_hmo_submissions_branch_status_idx;
DROP TABLE IF EXISTS patient_hmo_submissions;

ALTER TABLE patient_portal_profiles
  DROP COLUMN IF EXISTS hmo_verified_at,
  DROP COLUMN IF EXISTS hmo_verified_by,
  DROP COLUMN IF EXISTS hmo_verification_branch_id;
