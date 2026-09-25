-- Temporary scan retention: source files expire 24 hours after upload (server clock).

ALTER TABLE admin_portal_document_sync_jobs
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

UPDATE admin_portal_document_sync_jobs
SET expires_at = created_at + INTERVAL '24 hours'
WHERE expires_at IS NULL;

CREATE INDEX IF NOT EXISTS admin_portal_document_sync_jobs_expires_idx
  ON admin_portal_document_sync_jobs (expires_at)
  WHERE stored_name IS NOT NULL;
