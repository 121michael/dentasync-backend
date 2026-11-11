-- Dedicated PostgreSQL custom-format backups. Existing .dsb rows stay valid.

ALTER TABLE admin_portal_backups
  ADD COLUMN IF NOT EXISTS archive_format TEXT NOT NULL DEFAULT 'dsb',
  ADD COLUMN IF NOT EXISTS recovery_stage TEXT,
  ADD COLUMN IF NOT EXISTS dump_manifest JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE admin_portal_backups
SET archive_format = 'dsb'
WHERE archive_format IS NULL OR archive_format = '';

ALTER TABLE admin_portal_backups DROP CONSTRAINT IF EXISTS admin_portal_backups_backup_type_check;
ALTER TABLE admin_portal_backups
  ADD CONSTRAINT admin_portal_backups_backup_type_check
  CHECK (backup_type IN (
    'manual', 'scheduled', 'safety', 'upload', 'daily', 'weekly', 'monthly', 'pre_update', 'postgres_dump'
  ));

ALTER TABLE admin_portal_backup_operations DROP CONSTRAINT IF EXISTS admin_portal_backup_operations_operation_check;
ALTER TABLE admin_portal_backup_operations
  ADD CONSTRAINT admin_portal_backup_operations_operation_check
  CHECK (operation IN (
    'create', 'restore', 'delete', 'download', 'validate', 'upload', 'settings',
    'isolated_restore', 'offsite_upload', 'verify', 'transfer', 'notify', 'cron',
    'dump_test_restore'
  ));
