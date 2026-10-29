-- Persistent appointment SMS reminders, expanded SMS log fields, and send idempotency.

ALTER TABLE clinic_sms_logs DROP CONSTRAINT IF EXISTS clinic_sms_logs_delivery_status_check;

ALTER TABLE clinic_sms_logs
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

ALTER TABLE clinic_sms_logs
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;

ALTER TABLE clinic_sms_logs
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT;

ALTER TABLE clinic_sms_logs
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE clinic_sms_logs
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'automatic';

ALTER TABLE clinic_sms_logs
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

DO $$
BEGIN
  ALTER TABLE clinic_sms_logs
    ADD CONSTRAINT clinic_sms_logs_delivery_status_check
    CHECK (delivery_status IN (
      'pending',
      'scheduled',
      'processing',
      'sent',
      'failed',
      'skipped',
      'cancelled',
      'delivered'
    ));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS clinic_sms_logs_idempotency_idx
  ON clinic_sms_logs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS clinic_sms_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  sms_log_id BIGINT,
  delivery_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS clinic_appointment_sms_reminders (
  id BIGSERIAL PRIMARY KEY,
  appointment_id BIGINT NOT NULL,
  patient_user_id TEXT NOT NULL,
  reminder_kind TEXT NOT NULL
    CHECK (reminder_kind IN ('24h', '10h')),
  schedule_version INTEGER NOT NULL DEFAULT 1,
  appointment_at TIMESTAMPTZ NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  service_name TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'processing', 'sent', 'failed', 'cancelled', 'skipped')),
  sms_log_id BIGINT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  provider_message_id TEXT,
  locked_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS clinic_appointment_sms_reminders_unique
  ON clinic_appointment_sms_reminders (appointment_id, reminder_kind, schedule_version);

CREATE INDEX IF NOT EXISTS clinic_appointment_sms_reminders_due_idx
  ON clinic_appointment_sms_reminders (scheduled_for)
  WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS clinic_appointment_sms_reminders_appt_idx
  ON clinic_appointment_sms_reminders (appointment_id, status);

INSERT INTO admin_portal_settings (setting_key, setting_value)
VALUES (
  'sms',
  '{
    "smsEnabled": true,
    "appointmentSms": true,
    "appointmentReminderSms": true,
    "queueSms": true,
    "cleaningReminderSms": true,
    "cleaningReminderMonths": 5,
    "clinicName": "Amethyst Dental Clinic"
  }'::jsonb
)
ON CONFLICT (setting_key) DO NOTHING;
