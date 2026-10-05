-- Patient IDs: PREFIX + YYYY + MM + "_" + monthly sequence (A202609_01)

CREATE TABLE IF NOT EXISTS patient_id_sequences (
  category_prefix CHAR(1) NOT NULL CHECK (category_prefix IN ('A', 'S', 'P', 'W')),
  id_year INTEGER NOT NULL CHECK (id_year >= 2000 AND id_year <= 2100),
  id_month INTEGER NOT NULL CHECK (id_month >= 1 AND id_month <= 12),
  last_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (category_prefix, id_year, id_month)
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'patient_id_sequences'
      AND column_name = 'id_year'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'patient_id_sequences'
      AND column_name = 'id_month'
  ) THEN
    ALTER TABLE patient_id_sequences DROP CONSTRAINT IF EXISTS patient_id_sequences_pkey;
    ALTER TABLE patient_id_sequences ADD COLUMN id_month INTEGER;
    DELETE FROM patient_id_sequences;
    ALTER TABLE patient_id_sequences
      ALTER COLUMN id_month SET NOT NULL;
    ALTER TABLE patient_id_sequences
      ADD CONSTRAINT patient_id_sequences_id_month_check
        CHECK (id_month >= 1 AND id_month <= 12);
    ALTER TABLE patient_id_sequences
      ADD PRIMARY KEY (category_prefix, id_year, id_month);
  END IF;
END $$;

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
