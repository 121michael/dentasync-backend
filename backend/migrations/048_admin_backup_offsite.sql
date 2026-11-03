-- Additive Backup & Recovery upgrade. Does not drop legacy payload or history.

ALTER TABLE admin_portal_backups
  ADD COLUMN IF NOT EXISTS pipeline_status TEXT,
  ADD COLUMN IF NOT EXISTS storage_class TEXT NOT NULL DEFAULT 'legacy_database',
  ADD COLUMN IF NOT EXISTS offsite_object_key TEXT,
  ADD COLUMN IF NOT EXISTS offsite_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_detail TEXT,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS duration_ms INTEGER,
  ADD COLUMN IF NOT EXISTS excluded_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS file_manifest JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS pg_dump_status TEXT,
  ADD COLUMN IF NOT EXISTS encryption TEXT,
  ADD COLUMN IF NOT EXISTS schedule_slot TEXT;

UPDATE admin_portal_backups
SET pipeline_status = CASE status
  WHEN 'success' THEN 'completed'
  WHEN 'failed' THEN 'failed'
  ELSE 'running'
END
WHERE pipeline_status IS NULL;

ALTER TABLE admin_portal_backups DROP CONSTRAINT IF EXISTS admin_portal_backups_backup_type_check;
ALTER TABLE admin_portal_backups
  ADD CONSTRAINT admin_portal_backups_backup_type_check
  CHECK (backup_type IN ('manual', 'scheduled', 'safety', 'upload', 'daily', 'weekly', 'monthly', 'pre_update'));

ALTER TABLE admin_portal_backup_operations DROP CONSTRAINT IF EXISTS admin_portal_backup_operations_operation_check;
ALTER TABLE admin_portal_backup_operations
  ADD CONSTRAINT admin_portal_backup_operations_operation_check
  CHECK (operation IN (
    'create', 'restore', 'delete', 'download', 'validate', 'upload', 'settings',
    'isolated_restore', 'offsite_upload', 'verify', 'transfer', 'notify', 'cron'
  ));
