-- Staff portal data complements the patient portal without duplicating the
-- existing users, appointment, queue, treatment, or document records.

CREATE TABLE IF NOT EXISTS staff_portal_notifications (
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

CREATE INDEX IF NOT EXISTS staff_portal_notifications_user_idx
  ON staff_portal_notifications (user_id, read_at, created_at DESC);

CREATE TABLE IF NOT EXISTS staff_portal_dentist_availability (
  id BIGSERIAL PRIMARY KEY,
  dentist_id TEXT NOT NULL,
  dentist_name TEXT NOT NULL,
  availability_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'unavailable', 'on_leave')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT staff_portal_dentist_availability_time_range
    CHECK (end_time > start_time)
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_portal_dentist_availability_slot_unique
  ON staff_portal_dentist_availability (dentist_id, availability_date, start_time);

-- Staff need to record an in-chair and no-show state. Existing patient-facing
-- code continues to use `dentist` as its internal in-chair state.
ALTER TABLE patient_portal_queue_entries
  DROP CONSTRAINT IF EXISTS patient_portal_queue_entries_status_check;

ALTER TABLE patient_portal_queue_entries
  ADD CONSTRAINT patient_portal_queue_entries_status_check
  CHECK (status IN ('checked_in', 'waiting', 'preparing', 'dentist', 'completed', 'no_show'));

ALTER TABLE patient_portal_appointments
  DROP CONSTRAINT IF EXISTS patient_portal_appointments_status_check;

ALTER TABLE patient_portal_appointments
  ADD CONSTRAINT patient_portal_appointments_status_check
  CHECK (status IN ('pending', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show'));

DROP INDEX IF EXISTS patient_portal_appointments_active_slot_unique;

CREATE UNIQUE INDEX IF NOT EXISTS patient_portal_appointments_active_slot_unique
  ON patient_portal_appointments (dentist_id, appointment_date, appointment_time)
  WHERE status NOT IN ('cancelled', 'no_show');
