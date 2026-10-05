-- Amethyst Administrative Suite: audit logs, AI settings, schedules, archive metadata.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS archived_by TEXT;

CREATE TABLE IF NOT EXISTS admin_portal_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_id TEXT,
  actor_name TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  target_label TEXT,
  result TEXT NOT NULL DEFAULT 'success'
    CHECK (result IN ('success', 'warning', 'failed', 'blocked')),
  detail TEXT,
  ip_address TEXT,
  session_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS admin_portal_audit_logs_created_idx
  ON admin_portal_audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS admin_portal_audit_logs_actor_idx
  ON admin_portal_audit_logs (actor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_portal_staff_profiles (
  user_id TEXT PRIMARY KEY,
  operational_role TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_portal_schedules (
  id BIGSERIAL PRIMARY KEY,
  schedule_type TEXT NOT NULL
    CHECK (schedule_type IN ('dentist', 'staff', 'clinic_hours', 'blocked', 'availability')),
  title TEXT NOT NULL,
  assignee_id TEXT,
  assignee_name TEXT,
  day_of_week INTEGER CHECK (day_of_week IS NULL OR (day_of_week >= 0 AND day_of_week <= 6)),
  schedule_date DATE,
  start_time TEXT,
  end_time TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS admin_portal_schedules_active_idx
  ON admin_portal_schedules (is_active, schedule_type, schedule_date);

INSERT INTO admin_portal_settings (setting_key, setting_value)
VALUES
  (
    'ai',
    '{
      "amethystAiEnabled": true,
      "predictiveDiagnostics": true,
      "automatedReminders": true,
      "waitingTimePrediction": true,
      "aiChatbot": false,
      "scheduledSystemUpdates": true,
      "chatbotKnowledgeMode": "clinic",
      "diagnosticsSensitivity": "balanced"
    }'::jsonb
  )
ON CONFLICT (setting_key) DO NOTHING;
