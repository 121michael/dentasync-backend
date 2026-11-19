-- Phase 5 Set Credential: hashed authorization password for delegated dentists.
-- Apply after 058 via npm run migrate:record-access (056, 057, 058, then 060).
-- Reverse: npm run migrate:record-access:rollback (060, 058, 057, then 056).
--
-- Existing can_approve_cross_branch_access flags are preserved. Dentists who
-- already have the permission and no hash are marked setup_required and cannot
-- authorize until an administrator sets a credential. Hashes are bcrypt only;
-- plaintext secrets are never stored.

ALTER TABLE admin_portal_dentist_profiles
  ADD COLUMN IF NOT EXISTS authorization_password_hash TEXT;

ALTER TABLE admin_portal_dentist_profiles
  ADD COLUMN IF NOT EXISTS authorization_credential_status TEXT NOT NULL DEFAULT 'none';

UPDATE admin_portal_dentist_profiles
   SET authorization_credential_status = 'setup_required'
 WHERE can_approve_cross_branch_access IS TRUE
   AND COALESCE(authorization_credential_status, 'none') IN ('none', 'setup_required')
   AND (authorization_password_hash IS NULL OR btrim(authorization_password_hash) = '');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'admin_portal_dentist_profiles_auth_cred_status_check'
  ) THEN
    ALTER TABLE admin_portal_dentist_profiles
      ADD CONSTRAINT admin_portal_dentist_profiles_auth_cred_status_check
      CHECK (authorization_credential_status IN ('none', 'setup_required', 'configured', 'revoked'));
  END IF;
END $$;
