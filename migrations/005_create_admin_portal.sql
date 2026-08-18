-- Admin portal storage complements users and patient_portal_* tables.
-- It does not duplicate patient, staff, dentist, or appointment records.

CREATE TABLE IF NOT EXISTS admin_portal_notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS admin_portal_notifications_user_idx
  ON admin_portal_notifications (user_id, read_at, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_portal_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS admin_portal_dentist_profiles (
  user_id TEXT PRIMARY KEY,
  specialization TEXT,
  schedule_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_portal_sync_events (
  id BIGSERIAL PRIMARY KEY,
  triggered_by TEXT,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  database_ok BOOLEAN NOT NULL DEFAULT FALSE,
  api_ok BOOLEAN NOT NULL DEFAULT FALSE,
  email_ok BOOLEAN NOT NULL DEFAULT FALSE,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS admin_portal_sync_events_created_idx
  ON admin_portal_sync_events (created_at DESC);

INSERT INTO admin_portal_settings (setting_key, setting_value)
VALUES
  (
    'clinic',
    '{"name":"Amethyst Dental Clinic","address":"","phone":"","email":"","operatingHours":"Monday–Saturday · 9:00 AM – 6:00 PM"}'::jsonb
  ),
  (
    'appointments',
    '{"durationMinutes":45,"bookingLeadDays":1,"cancellationHours":24,"maxDailyAppointments":40}'::jsonb
  ),
  (
    'notifications',
    '{"emailNotifications":true,"appointmentNotifications":true,"systemAlerts":true}'::jsonb
  ),
  (
    'general',
    '{"dateFormat":"MM/DD/YYYY","timeZone":"Asia/Manila"}'::jsonb
  )
ON CONFLICT (setting_key) DO NOTHING;
