-- Procedure authorization / informed-consent records.
-- Files are stored outside this table in protected uploads; this table holds metadata only.
-- Signed rows are never deleted by application code; they may be superseded or voided.

CREATE TABLE IF NOT EXISTS dental_procedure_authorizations (
  id UUID PRIMARY KEY,
  document_number TEXT NOT NULL UNIQUE,
  clinical_record_id BIGINT NOT NULL REFERENCES clinic_patient_records(id),
  linked_user_id TEXT,
  appointment_id BIGINT,
  treatment_id BIGINT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'awaiting_signature', 'signed', 'superseded', 'voided')),
  supersedes_id UUID REFERENCES dental_procedure_authorizations(id),
  superseded_by_id UUID REFERENCES dental_procedure_authorizations(id),
  patient_full_name TEXT NOT NULL,
  patient_clinic_id TEXT,
  patient_date_of_birth DATE,
  patient_age TEXT,
  patient_phone TEXT,
  procedure_name TEXT NOT NULL,
  tooth_or_area TEXT,
  treating_dentist TEXT,
  planned_procedure_date DATE,
  clinical_notes TEXT,
  explanation TEXT NOT NULL,
  expected_benefits TEXT NOT NULL,
  material_risks TEXT NOT NULL,
  alternatives TEXT NOT NULL,
  questions_opportunity TEXT NOT NULL,
  voluntary_authorization TEXT NOT NULL,
  withdrawal_statement TEXT NOT NULL,
  understanding_confirmation TEXT NOT NULL,
  patient_or_representative_name TEXT,
  representative_relationship TEXT,
  patient_signed_at TIMESTAMPTZ,
  dentist_name TEXT,
  dentist_signed_at TIMESTAMPTZ,
  witness_name TEXT,
  guardian_name TEXT,
  consent_recorded_at TIMESTAMPTZ,
  consent_recorded_by TEXT,
  consent_recorded_by_role TEXT,
  original_name TEXT,
  stored_name TEXT,
  mime_type TEXT,
  byte_size BIGINT CHECK (byte_size IS NULL OR byte_size >= 0),
  upload_contains_signature BOOLEAN NOT NULL DEFAULT FALSE,
  uploaded_at TIMESTAMPTZ,
  uploaded_by TEXT,
  uploaded_by_role TEXT,
  created_by TEXT,
  created_by_role TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS dental_procedure_authorizations_record_idx
  ON dental_procedure_authorizations (clinical_record_id, created_at DESC);

CREATE INDEX IF NOT EXISTS dental_procedure_authorizations_user_idx
  ON dental_procedure_authorizations (linked_user_id, created_at DESC)
  WHERE linked_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS dental_procedure_authorizations_status_idx
  ON dental_procedure_authorizations (status, created_at DESC);
