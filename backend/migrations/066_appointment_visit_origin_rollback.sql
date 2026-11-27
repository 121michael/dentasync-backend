ALTER TABLE patient_portal_appointments
  DROP CONSTRAINT IF EXISTS patient_portal_appointments_visit_origin_check;

ALTER TABLE patient_portal_appointments
  DROP COLUMN IF EXISTS visit_origin;
