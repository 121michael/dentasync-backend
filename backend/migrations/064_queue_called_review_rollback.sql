DROP INDEX IF EXISTS patient_portal_queue_entries_needs_review_open_idx;
DROP INDEX IF EXISTS patient_portal_queue_status_events_queue_idx;
DROP TABLE IF EXISTS patient_portal_queue_status_events;

ALTER TABLE patient_portal_queue_entries
  DROP COLUMN IF EXISTS review_outcome;

ALTER TABLE patient_portal_queue_entries
  DROP COLUMN IF EXISTS reviewed_by;

ALTER TABLE patient_portal_queue_entries
  DROP COLUMN IF EXISTS closure_from_status;

ALTER TABLE patient_portal_queue_entries
  DROP COLUMN IF EXISTS called_at;
