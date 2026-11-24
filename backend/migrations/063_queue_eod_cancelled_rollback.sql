-- Reverse 063. Cancelled queue rows become not_served so 062's check can apply.

UPDATE patient_portal_queue_entries
SET status = 'not_served'
WHERE status = 'cancelled';

UPDATE patient_portal_queue_entries
SET status = 'preparing'
WHERE status = 'called';

ALTER TABLE patient_portal_queue_entries
  DROP CONSTRAINT IF EXISTS patient_portal_queue_entries_status_check;

ALTER TABLE patient_portal_queue_entries
  ADD CONSTRAINT patient_portal_queue_entries_status_check
    CHECK (status IN (
      'checked_in',
      'waiting',
      'preparing',
      'dentist',
      'completed',
      'no_show',
      'not_served',
      'needs_review'
    ));

DROP INDEX IF EXISTS patient_portal_queue_entries_active_appointment_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS patient_portal_queue_entries_active_appointment_uidx
  ON patient_portal_queue_entries (appointment_id)
  WHERE appointment_id IS NOT NULL
    AND status NOT IN ('completed', 'no_show', 'not_served', 'needs_review');
