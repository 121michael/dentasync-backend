-- Persistent backup catalog stored in PostgreSQL so records survive Render deploys.
-- Payload lives in this table (not ephemeral local disk). Off-site copies require an admin download.

CREATE TABLE IF NOT EXISTS admin_portal_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_type TEXT NOT NULL CHECK (backup_type IN ('manual', 'scheduled', 'safety', 'upload')),
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'success', 'failed')),
  file_name TEXT NOT NULL,
  byte_size INTEGER NOT NULL DEFAULT 0,
  checksum_sha256 TEXT,
  format_version INTEGER NOT NULL DEFAULT 1,
  table_count INTEGER NOT NULL DEFAULT 0,
  row_count INTEGER NOT NULL DEFAULT 0,
  table_names TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  payload BYTEA,
  error_detail TEXT,
  created_by_id TEXT,
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMPTZ,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS admin_portal_backups_created_idx
  ON admin_portal_backups (created_at DESC);

CREATE TABLE IF NOT EXISTS admin_portal_backup_operations (
  id BIGSERIAL PRIMARY KEY,
  backup_id UUID,
  operation TEXT NOT NULL CHECK (operation IN (
    'create', 'restore', 'delete', 'download', 'validate', 'upload', 'settings'
  )),
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'success', 'failed', 'blocked')),
  actor_id TEXT,
  actor_name TEXT,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS admin_portal_backup_operations_created_idx
  ON admin_portal_backup_operations (created_at DESC);

INSERT INTO admin_portal_settings (setting_key, setting_value)
VALUES (
  'backup',
  '{"schedule":"manual","retentionCount":12,"timezone":"Asia/Manila"}'::jsonb
)
ON CONFLICT (setting_key) DO NOTHING;
