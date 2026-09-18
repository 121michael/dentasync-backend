-- Patient clinic IDs: PREFIX + YEAR + "_" + zero-padded sequence
-- Categories: regular(A), senior(S), pediatric(P), pwd(W)

CREATE TABLE IF NOT EXISTS patient_id_sequences (
  category_prefix CHAR(1) NOT NULL CHECK (category_prefix IN ('A', 'S', 'P', 'W')),
  id_year INTEGER NOT NULL CHECK (id_year >= 2000 AND id_year <= 2100),
  last_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (category_prefix, id_year)
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS patient_id TEXT,
  ADD COLUMN IF NOT EXISTS patient_category TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_patient_id_unique'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_patient_id_unique UNIQUE (patient_id);
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS users_patient_id_idx ON users (patient_id)
  WHERE patient_id IS NOT NULL;

ALTER TABLE patient_portal_profiles
  ADD COLUMN IF NOT EXISTS patient_category TEXT;

ALTER TABLE clinic_patient_records
  ADD COLUMN IF NOT EXISTS patient_id TEXT,
  ADD COLUMN IF NOT EXISTS patient_category TEXT;

CREATE INDEX IF NOT EXISTS clinic_patient_records_patient_id_idx
  ON clinic_patient_records (patient_id)
  WHERE patient_id IS NOT NULL;
