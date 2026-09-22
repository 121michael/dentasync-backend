-- Automatic queue wait estimates: duration history + range columns.
-- Does not replace patient_portal_queue_entries; extends it.

CREATE TABLE IF NOT EXISTS clinic_treatment_durations (
  id BIGSERIAL PRIMARY KEY,
  patient_user_id TEXT,
  appointment_id BIGINT,
  queue_entry_id BIGINT,
  procedure_type TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  duration_minutes INTEGER,
  dentist_id TEXT,
  chair_id TEXT,
  source TEXT NOT NULL DEFAULT 'queue',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS clinic_treatment_durations_procedure_idx
  ON clinic_treatment_durations (LOWER(procedure_type), completed_at);

CREATE INDEX IF NOT EXISTS clinic_treatment_durations_patient_idx
  ON clinic_treatment_durations (patient_user_id);

CREATE INDEX IF NOT EXISTS clinic_treatment_durations_appointment_idx
  ON clinic_treatment_durations (appointment_id);

CREATE INDEX IF NOT EXISTS clinic_treatment_durations_queue_idx
  ON clinic_treatment_durations (queue_entry_id);

CREATE INDEX IF NOT EXISTS clinic_treatment_durations_dentist_idx
  ON clinic_treatment_durations (dentist_id);

CREATE UNIQUE INDEX IF NOT EXISTS clinic_treatment_durations_open_queue_idx
  ON clinic_treatment_durations (queue_entry_id)
  WHERE completed_at IS NULL AND queue_entry_id IS NOT NULL;

ALTER TABLE clinic_patient_treatments
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE patient_portal_queue_entries
  ADD COLUMN IF NOT EXISTS serving_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS wait_estimate_min_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS wait_estimate_max_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS wait_estimate_duration_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS wait_estimate_call_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS wait_estimate_call_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS wait_estimate_method TEXT,
  ADD COLUMN IF NOT EXISTS wait_estimate_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS patient_portal_queue_serving_idx
  ON patient_portal_queue_entries (status, serving_started_at);
