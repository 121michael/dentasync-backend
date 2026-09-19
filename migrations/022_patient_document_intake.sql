-- Admin patient document intake: upload/scan documents, extract patient details,
-- review them, then map them onto the canonical patient record.
-- Verification remains a separate Admin-only action.

CREATE TABLE IF NOT EXISTS admin_patient_intake_sessions (
  id BIGSERIAL PRIMARY KEY,
  created_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'saved', 'cancelled')),
  fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  manual_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  conflicts JSONB NOT NULL DEFAULT '[]'::jsonb,
  category_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  -- Canonical patient this intake was mapped onto (existing account and/or clinical record).
  linked_user_id TEXT,
  clinical_record_id BIGINT REFERENCES clinic_patient_records (id) ON DELETE SET NULL,
  patient_id TEXT,
  saved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS admin_patient_intake_sessions_created_idx
  ON admin_patient_intake_sessions (created_by, created_at DESC);

-- Patient → Documents. Documents belong to the patient (clinical record / account),
-- with the intake session kept only as processing provenance.
CREATE TABLE IF NOT EXISTS patient_documents (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT REFERENCES admin_patient_intake_sessions (id) ON DELETE SET NULL,
  clinical_record_id BIGINT REFERENCES clinic_patient_records (id) ON DELETE CASCADE,
  linked_user_id TEXT,
  patient_id TEXT,
  original_name TEXT NOT NULL,
  stored_name TEXT,
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
  source_type TEXT NOT NULL DEFAULT 'upload'
    CHECK (source_type IN ('upload', 'scan')),
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'processed', 'failed', 'attached')),
  page_count INTEGER NOT NULL DEFAULT 1 CHECK (page_count >= 0),
  extracted_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  extraction_method TEXT,
  extraction_notes TEXT,
  error_message TEXT,
  processed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS patient_documents_session_idx
  ON patient_documents (session_id, created_at);

CREATE INDEX IF NOT EXISTS patient_documents_record_idx
  ON patient_documents (clinical_record_id, created_at DESC);

CREATE INDEX IF NOT EXISTS patient_documents_user_idx
  ON patient_documents (linked_user_id)
  WHERE linked_user_id IS NOT NULL;
