-- Encrypted recoverable copy of the Set Credential authorization password.
-- The bcrypt hash remains the source of truth for authorization checks.
-- Existing hash-only rows stay configured and cannot be viewed until reset.
-- Reverse: npm run migrate:record-access:rollback (drops these columns first).

ALTER TABLE admin_portal_dentist_profiles
  ADD COLUMN IF NOT EXISTS authorization_password_ciphertext TEXT;

ALTER TABLE admin_portal_dentist_profiles
  ADD COLUMN IF NOT EXISTS authorization_secret_key_id TEXT;
