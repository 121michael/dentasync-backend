ALTER TABLE patient_portal_appointments
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by TEXT,
  ADD COLUMN IF NOT EXISTS rescheduled_from_id BIGINT,
  ADD COLUMN IF NOT EXISTS rescheduled_to_id BIGINT;

DO $$
BEGIN
  ALTER TABLE patient_portal_appointments
    DROP CONSTRAINT IF EXISTS patient_portal_appointments_status_check;
  ALTER TABLE patient_portal_appointments
    ADD CONSTRAINT patient_portal_appointments_status_check
    CHECK (status IN ('pending', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show', 'rescheduled'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DROP INDEX IF EXISTS patient_portal_appointments_active_slot_unique;

CREATE UNIQUE INDEX IF NOT EXISTS patient_portal_appointments_active_slot_unique
  ON patient_portal_appointments (dentist_id, appointment_date, appointment_time)
  WHERE status NOT IN ('cancelled', 'no_show', 'rescheduled');

CREATE INDEX IF NOT EXISTS patient_portal_appointments_rescheduled_from_idx
  ON patient_portal_appointments (rescheduled_from_id)
  WHERE rescheduled_from_id IS NOT NULL;
