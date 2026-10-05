-- Patient SMS preferences, clinic SMS settings seed, and cleaning-reminder audit.

ALTER TABLE patient_portal_preferences
  ADD COLUMN IF NOT EXISTS notify_sms BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE patient_portal_preferences
  ADD COLUMN IF NOT EXISTS notify_appointment_sms BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE patient_portal_preferences
  ADD COLUMN IF NOT EXISTS notify_queue_sms BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE patient_portal_preferences
  ADD COLUMN IF NOT EXISTS notify_cleaning_sms BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS clinic_sms_logs (
  id BIGSERIAL PRIMARY KEY,
  patient_user_id TEXT,
  patient_phone TEXT,
  appointment_id BIGINT,
  queue_entry_id BIGINT,
  message_type TEXT NOT NULL,
  message_body TEXT NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending', 'sent', 'failed', 'skipped')),
  error_detail TEXT,
  actor_role TEXT,
  actor_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS clinic_sms_logs_created_idx
  ON clinic_sms_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS clinic_sms_logs_patient_idx
  ON clinic_sms_logs (patient_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS clinic_sms_reminder_runs (
  id BIGSERIAL PRIMARY KEY,
  patient_user_id TEXT NOT NULL,
  reminder_type TEXT NOT NULL DEFAULT 'cleaning',
  reference_date DATE,
  message_body TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'pending',
  sms_log_id BIGINT,
  period_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS clinic_sms_reminder_runs_unique_period
  ON clinic_sms_reminder_runs (patient_user_id, reminder_type, period_key);

INSERT INTO admin_portal_settings (setting_key, setting_value)
VALUES (
  'sms',
  '{
    "smsEnabled": true,
    "appointmentSms": true,
    "queueSms": true,
    "cleaningReminderSms": true,
    "cleaningReminderMonths": 5,
    "clinicName": "Amethyst Dental Clinic"
  }'::jsonb
)
ON CONFLICT (setting_key) DO NOTHING;
