-- Encrypted recoverable copy of the Set Credential authorization password.
-- Included in npm run migrate:record-access after 060. ADD COLUMN IF NOT EXISTS is
-- safe to rerun and does not rewrite hashes, grants, or patient rows.
-- The bcrypt hash remains the source of truth for authorization checks.
-- Existing hash-only rows stay configured and cannot be viewed until reset.
-- Reverse: npm run migrate:record-access:rollback (drops these columns first).
-- Do not apply from application startup. Run it once from the backend folder.

ALTER TABLE admin_portal_dentist_profiles
  ADD COLUMN IF NOT EXISTS authorization_password_ciphertext TEXT;

ALTER TABLE admin_portal_dentist_profiles
  ADD COLUMN IF NOT EXISTS authorization_secret_key_id TEXT;
