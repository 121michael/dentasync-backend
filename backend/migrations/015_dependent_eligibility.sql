-- Dependent eligibility categories for authorized account managers.
ALTER TABLE patient_portal_dependents
  ADD COLUMN IF NOT EXISTS eligibility_category TEXT;

COMMENT ON COLUMN patient_portal_dependents.eligibility_category IS
  'toddler | child_under_12 | pwd | senior | other_authorized';
