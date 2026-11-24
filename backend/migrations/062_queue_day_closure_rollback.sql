-- Reverse 062_queue_day_closure.sql. Historical Not Served / Needs Review rows are rewritten
-- so the original status check can be restored. Queue tickets are kept.

UPDATE patient_portal_queue_entries
SET status = 'no_show'
WHERE status = 'not_served';

UPDATE patient_portal_queue_entries
SET status = 'dentist'
WHERE status = 'needs_review';

DROP INDEX IF EXISTS patient_portal_queue_entries_needs_review_idx;
DROP INDEX IF EXISTS patient_portal_queue_entries_active_appointment_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS patient_portal_queue_entries_active_appointment_uidx
  ON patient_portal_queue_entries (appointment_id)
  WHERE appointment_id IS NOT NULL
    AND status NOT IN ('completed', 'no_show');

ALTER TABLE patient_portal_queue_entries
  DROP CONSTRAINT IF EXISTS patient_portal_queue_entries_status_check;

ALTER TABLE patient_portal_queue_entries
  ADD CONSTRAINT patient_portal_queue_entries_status_check
  CHECK (status IN ('checked_in', 'waiting', 'preparing', 'dentist', 'completed', 'no_show'));

ALTER TABLE patient_portal_queue_entries
  DROP COLUMN IF EXISTS reviewed_at;

ALTER TABLE patient_portal_queue_entries
  DROP COLUMN IF EXISTS closed_operating_date;

ALTER TABLE patient_portal_queue_entries
  DROP COLUMN IF EXISTS closed_at;

DROP TABLE IF EXISTS clinic_queue_day_closures;
