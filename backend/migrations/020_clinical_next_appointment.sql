-- Shared next-appointment fields on the clinical patient record (dentist + staff vault).
ALTER TABLE clinic_patient_records
  ADD COLUMN IF NOT EXISTS next_appointment_date DATE,
  ADD COLUMN IF NOT EXISTS next_appointment_time TEXT;

CREATE INDEX IF NOT EXISTS clinic_patient_records_next_appt_idx
  ON clinic_patient_records (next_appointment_date);
