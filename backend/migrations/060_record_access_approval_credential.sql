-- Phase 5 dentist approval credential: hashed PIN/passphrase, never derived
-- from PRC license. Apply after 058 via npm run migrate:record-access.
-- Reverse: npm run migrate:record-access:rollback (060, 058, 057, then 056).
--
-- Existing grants, pending requests, decisions, and audit rows are kept.
-- Delegated dentists keep can_approve_cross_branch_access. Credential status
-- starts as not_set until the dentist stores their own secret after sign-in.

ALTER TABLE admin_portal_dentist_profiles
  ADD COLUMN IF NOT EXISTS cross_branch_approval_secret_hash TEXT;

ALTER TABLE admin_portal_dentist_profiles
  ADD COLUMN IF NOT EXISTS cross_branch_approval_credential_status TEXT NOT NULL DEFAULT 'not_set';

UPDATE admin_portal_dentist_profiles
SET cross_branch_approval_credential_status = 'not_set'
WHERE cross_branch_approval_credential_status IS NULL
   OR BTRIM(cross_branch_approval_credential_status) = '';

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'admin_portal_dentist_profiles_approval_cred_status_check'
  ) THEN
    ALTER TABLE admin_portal_dentist_profiles
      ADD CONSTRAINT admin_portal_dentist_profiles_approval_cred_status_check
      CHECK (cross_branch_approval_credential_status IN ('not_set', 'active', 'revoked'));
  END IF;
END
$migration$;

ALTER TABLE record_access_challenges
  ADD COLUMN IF NOT EXISTS credential_verified_at TIMESTAMPTZ;

ALTER TABLE record_access_challenges
  ADD COLUMN IF NOT EXISTS credential_verified_by TEXT;
