-- Link dentist user accounts to the patient-booking catalog dentist_id values.
-- Reuses admin_portal_dentist_profiles; does not duplicate appointment/queue tables.

ALTER TABLE admin_portal_dentist_profiles
  ADD COLUMN IF NOT EXISTS catalog_dentist_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS admin_portal_dentist_profiles_catalog_uidx
  ON admin_portal_dentist_profiles (catalog_dentist_id)
  WHERE catalog_dentist_id IS NOT NULL AND catalog_dentist_id <> '';
