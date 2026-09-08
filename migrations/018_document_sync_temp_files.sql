-- Temporary source documents only: clear permanent file references after import/reject.

ALTER TABLE admin_portal_document_sync_jobs
  ALTER COLUMN stored_name DROP NOT NULL;

COMMENT ON COLUMN admin_portal_document_sync_jobs.stored_name IS
  'Temporary on-disk filename while Admin reviews extraction. Cleared after commit/reject; original documents are never permanently stored.';
