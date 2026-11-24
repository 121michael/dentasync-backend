DROP TABLE IF EXISTS patient_portal_appointment_services;

ALTER TABLE patient_portal_appointments
  DROP COLUMN IF EXISTS duration_minutes;
