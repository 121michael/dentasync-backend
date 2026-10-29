-- Prescription management: versions, authorization, PDF metadata, email attempts, audit.
-- Clinical authorization is independent of email delivery status.

CREATE TABLE IF NOT EXISTS prescriptions (
  id UUID PRIMARY KEY,
  prescription_number TEXT NOT NULL UNIQUE,
  clinical_record_id BIGINT NOT NULL REFERENCES clinic_patient_records(id),
  linked_user_id TEXT,
  appointment_id BIGINT,
  treatment_id BIGINT,
  current_version INTEGER NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  workflow_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (workflow_status IN (
      'draft',
      'sent_to_staff',
      'processing',
      'returned_to_dentist',
      'authorized',
      'cancelled'
    )),
  email_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (email_status IN ('pending', 'sending', 'sent', 'failed', 'bounced', 'unknown')),
  include_extraction_aftercare BOOLEAN NOT NULL DEFAULT FALSE,
  return_reason TEXT,
  created_by_dentist_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelled_at TIMESTAMPTZ,
  cancelled_by TEXT,
  cancelled_by_role TEXT
);

CREATE INDEX IF NOT EXISTS prescriptions_record_idx
  ON prescriptions (clinical_record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS prescriptions_status_idx
  ON prescriptions (workflow_status, created_at DESC);
CREATE INDEX IF NOT EXISTS prescriptions_dentist_idx
  ON prescriptions (created_by_dentist_id, created_at DESC);

CREATE TABLE IF NOT EXISTS prescription_versions (
  id UUID PRIMARY KEY,
  prescription_id UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 1),
  content_hash TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  clinical_notes TEXT,
  created_by TEXT NOT NULL,
  created_by_role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  authorized_at TIMESTAMPTZ,
  authorized_by TEXT,
  authorization_method TEXT,
  UNIQUE (prescription_id, version)
);

CREATE INDEX IF NOT EXISTS prescription_versions_rx_idx
  ON prescription_versions (prescription_id, version DESC);

CREATE TABLE IF NOT EXISTS prescription_items (
  id UUID PRIMARY KEY,
  version_id UUID NOT NULL REFERENCES prescription_versions(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  medication_name TEXT NOT NULL,
  strength TEXT,
  dosage TEXT NOT NULL,
  quantity TEXT NOT NULL,
  frequency TEXT NOT NULL,
  duration TEXT NOT NULL,
  route TEXT,
  sig TEXT NOT NULL,
  additional_instructions TEXT
);

CREATE INDEX IF NOT EXISTS prescription_items_version_idx
  ON prescription_items (version_id, sort_order);

CREATE TABLE IF NOT EXISTS prescription_pdfs (
  id UUID PRIMARY KEY,
  prescription_id UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  version_id UUID NOT NULL REFERENCES prescription_versions(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  byte_size BIGINT CHECK (byte_size IS NULL OR byte_size >= 0),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  generated_by TEXT,
  generated_by_role TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS prescription_pdfs_version_hash_idx
  ON prescription_pdfs (version_id, content_hash);

CREATE TABLE IF NOT EXISTS prescription_email_attempts (
  id UUID PRIMARY KEY,
  prescription_id UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  version_id UUID NOT NULL REFERENCES prescription_versions(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  intended_recipient TEXT NOT NULL,
  actual_recipient TEXT NOT NULL,
  staff_user_id TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('sending', 'sent', 'failed', 'unknown', 'bounced')),
  provider_message_id TEXT,
  provider_result TEXT,
  failure_detail TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS prescription_email_attempts_rx_idx
  ON prescription_email_attempts (prescription_id, attempted_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS prescription_email_sent_once_idx
  ON prescription_email_attempts (prescription_id, version_id)
  WHERE status = 'sent';

CREATE TABLE IF NOT EXISTS prescription_audit_events (
  id UUID PRIMARY KEY,
  prescription_id UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  version INTEGER,
  actor_id TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS prescription_audit_rx_idx
  ON prescription_audit_events (prescription_id, created_at DESC);
