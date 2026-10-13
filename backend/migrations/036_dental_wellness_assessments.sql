-- Dentist-entered dental wellness assessments.
-- Last cleaning is derived from completed Oral Prophylaxis treatment rows,
-- not stored as a separately editable copy.

CREATE TABLE IF NOT EXISTS dental_wellness_assessments (
  id BIGSERIAL PRIMARY KEY,
  clinical_record_id BIGINT NOT NULL REFERENCES clinic_patient_records(id) ON DELETE CASCADE,
  patient_user_id TEXT,
  assessment_date DATE NOT NULL,
  wellness_score SMALLINT NOT NULL CHECK (wellness_score BETWEEN 0 AND 100),
  clinical_notes TEXT,
  next_checkup DATE,
  dentist_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS dental_wellness_assessments_record_uidx
  ON dental_wellness_assessments (clinical_record_id);

CREATE INDEX IF NOT EXISTS dental_wellness_assessments_patient_user_idx
  ON dental_wellness_assessments (patient_user_id, assessment_date DESC, id DESC);

COMMENT ON TABLE dental_wellness_assessments IS
  'Clinician dental wellness assessments. Patients may view the latest score; only dentists may create or update it.';
