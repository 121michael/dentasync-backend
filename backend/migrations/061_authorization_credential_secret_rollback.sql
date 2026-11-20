-- Removes the recoverable encrypted credential copy. bcrypt hashes and
-- authorization status flags stay, so dentists can still approve.

ALTER TABLE admin_portal_dentist_profiles
  DROP COLUMN IF EXISTS authorization_password_ciphertext;

ALTER TABLE admin_portal_dentist_profiles
  DROP COLUMN IF EXISTS authorization_secret_key_id;
