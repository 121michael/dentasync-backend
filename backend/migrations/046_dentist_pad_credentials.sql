-- Optional pad credentials printed on authorized prescriptions.
-- Additive only; existing dentist profiles keep working with blank license/PTR lines.

ALTER TABLE admin_portal_dentist_profiles
  ADD COLUMN IF NOT EXISTS license_number TEXT;

ALTER TABLE admin_portal_dentist_profiles
  ADD COLUMN IF NOT EXISTS ptr_number TEXT;

ALTER TABLE admin_portal_dentist_profiles
  ADD COLUMN IF NOT EXISTS professional_designation TEXT;
