-- Document-to-database synchronization jobs for scanned/soft-copy dental records.

CREATE TABLE IF NOT EXISTS admin_portal_document_sync_jobs (
  id BIGSERIAL PRIMARY KEY,
  uploaded_by TEXT NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
  source_type TEXT NOT NULL DEFAULT 'soft_copy'
    CHECK (source_type IN ('soft_copy', 'hard_copy_scan')),
  status TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'extracted', 'reviewed', 'synced', 'failed')),
  raw_text TEXT,
  extracted_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  edited_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  extraction_notes TEXT,
  linked_patient_id TEXT,
  linked_treatment_id BIGINT,
  error_message TEXT,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS admin_portal_document_sync_jobs_status_idx
  ON admin_portal_document_sync_jobs (status, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_portal_document_sync_jobs_uploader_idx
  ON admin_portal_document_sync_jobs (uploaded_by, created_at DESC);
