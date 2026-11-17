-- Drops dentist approval credential columns. Grants, requests, and audit stay.

ALTER TABLE record_access_challenges
  DROP COLUMN IF EXISTS credential_verified_by;

ALTER TABLE record_access_challenges
  DROP COLUMN IF EXISTS credential_verified_at;

ALTER TABLE admin_portal_dentist_profiles
  DROP CONSTRAINT IF EXISTS admin_portal_dentist_profiles_approval_cred_status_check;

ALTER TABLE admin_portal_dentist_profiles
  DROP COLUMN IF EXISTS cross_branch_approval_credential_status;

ALTER TABLE admin_portal_dentist_profiles
  DROP COLUMN IF EXISTS cross_branch_approval_secret_hash;
