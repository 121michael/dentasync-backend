-- Queue entries cancelled at 6:00 PM Asia/Manila (Waiting / Called) without
-- treating them as no-shows. ADD CONSTRAINT is idempotent via DROP IF EXISTS.
-- Apply: npm run migrate:queue-day-closure
-- Do not run from application startup.

ALTER TABLE patient_portal_queue_entries
  DROP CONSTRAINT IF EXISTS patient_portal_queue_entries_status_check;

ALTER TABLE patient_portal_queue_entries
  ADD CONSTRAINT patient_portal_queue_entries_status_check
    CHECK (status IN (
      'checked_in',
      'waiting',
      'preparing',
      'called',
      'dentist',
      'completed',
      'cancelled',
      'no_show',
      'not_served',
      'needs_review'
    ));

DROP INDEX IF EXISTS patient_portal_queue_entries_active_appointment_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS patient_portal_queue_entries_active_appointment_uidx
  ON patient_portal_queue_entries (appointment_id)
  WHERE appointment_id IS NOT NULL
    AND status NOT IN ('completed', 'cancelled', 'no_show', 'not_served', 'needs_review');
