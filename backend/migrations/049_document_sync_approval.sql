-- Approved imports keep the source file on the selected clinical patient.
-- Unsaved scans still expire. approved_by records the admin who confirmed the save.

ALTER TABLE admin_portal_document_sync_jobs
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_by_name TEXT;

COMMENT ON COLUMN admin_portal_document_sync_jobs.stored_name IS
  'On-disk filename. Temporary until an admin approves the import, then kept with the selected clinical patient.';
