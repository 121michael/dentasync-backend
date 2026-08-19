-- Clinical patient records are NOT login accounts.
-- Dentist/staff create and maintain these; admin can view.
-- Optional linked_user_id connects a self-registered patient account later.

CREATE TABLE IF NOT EXISTS clinic_patient_records (
  id BIGSERIAL PRIMARY KEY,
  record_code TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  date_of_birth DATE,
  gender TEXT,
  address TEXT,
  notes TEXT,
  linked_user_id TEXT,
  created_by TEXT,
  created_by_role TEXT,
  updated_by TEXT,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at TIMESTAMPTZ,
  archived_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS clinic_patient_records_name_idx
  ON clinic_patient_records (last_name, first_name);

CREATE INDEX IF NOT EXISTS clinic_patient_records_contact_idx
  ON clinic_patient_records (email, phone);

CREATE INDEX IF NOT EXISTS clinic_patient_records_linked_user_idx
  ON clinic_patient_records (linked_user_id);

CREATE TABLE IF NOT EXISTS clinic_patient_treatments (
  id BIGSERIAL PRIMARY KEY,
  clinical_record_id BIGINT NOT NULL REFERENCES clinic_patient_records(id) ON DELETE CASCADE,
  treatment TEXT NOT NULL,
  dentist_name TEXT,
  clinic_location TEXT,
  coverage_status TEXT,
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('planned', 'in_progress', 'completed')),
  treatment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_by TEXT,
  created_by_role TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS clinic_patient_treatments_record_date_idx
  ON clinic_patient_treatments (clinical_record_id, treatment_date DESC);
