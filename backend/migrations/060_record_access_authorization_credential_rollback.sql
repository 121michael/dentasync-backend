-- Removes authorization credential columns. Permission flags, grants, requests,
-- decisions, and audit rows stay. Dentists who could approve become unable to
-- until the forward migration is reapplied and a credential is set again.

ALTER TABLE admin_portal_dentist_profiles
  DROP CONSTRAINT IF EXISTS admin_portal_dentist_profiles_auth_cred_status_check;

ALTER TABLE admin_portal_dentist_profiles
  DROP COLUMN IF EXISTS authorization_password_hash;

ALTER TABLE admin_portal_dentist_profiles
  DROP COLUMN IF EXISTS authorization_credential_status;
