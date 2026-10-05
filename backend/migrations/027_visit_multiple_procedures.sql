-- Multiple procedures on the same visit/check-in.

ALTER TABLE clinic_patient_treatments
  ADD COLUMN IF NOT EXISTS queue_entry_id BIGINT,
  ADD COLUMN IF NOT EXISTS visit_sequence INTEGER;

CREATE INDEX IF NOT EXISTS clinic_patient_treatments_queue_entry_idx
  ON clinic_patient_treatments (queue_entry_id, visit_sequence, id);

CREATE INDEX IF NOT EXISTS clinic_patient_treatments_visit_status_idx
  ON clinic_patient_treatments (queue_entry_id, status);

ALTER TABLE clinic_treatment_durations
  ADD COLUMN IF NOT EXISTS treatment_id BIGINT;

CREATE INDEX IF NOT EXISTS clinic_treatment_durations_treatment_idx
  ON clinic_treatment_durations (treatment_id);

DROP INDEX IF EXISTS clinic_treatment_durations_open_queue_idx;

CREATE UNIQUE INDEX IF NOT EXISTS clinic_treatment_durations_open_treatment_idx
  ON clinic_treatment_durations (treatment_id)
  WHERE completed_at IS NULL AND treatment_id IS NOT NULL;
