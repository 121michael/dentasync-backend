ALTER TABLE patient_portal_documents
  ADD COLUMN IF NOT EXISTS appointment_id BIGINT,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'uploaded',
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by_name TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'patient_portal_documents_status_check'
  ) THEN
    ALTER TABLE patient_portal_documents
      ADD CONSTRAINT patient_portal_documents_status_check
      CHECK (status IN ('uploaded', 'reviewed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS patient_portal_documents_user_type_idx
  ON patient_portal_documents (user_id, document_type, created_at DESC);

CREATE INDEX IF NOT EXISTS patient_portal_documents_appointment_idx
  ON patient_portal_documents (appointment_id, created_at DESC)
  WHERE appointment_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'patient_portal_documents_appointment_fk'
  ) THEN
    ALTER TABLE patient_portal_documents
      ADD CONSTRAINT patient_portal_documents_appointment_fk
      FOREIGN KEY (appointment_id)
      REFERENCES patient_portal_appointments (id)
      ON DELETE SET NULL;
  END IF;
END $$;
