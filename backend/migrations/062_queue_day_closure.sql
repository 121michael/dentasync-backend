-- End-of-day queue closure: Not Served and Needs Review, plus one closure row per branch operating day.
-- Apply: npm run migrate:queue-day-closure
-- Reverse: npm run migrate:queue-day-closure -- --rollback

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

ALTER TABLE patient_portal_queue_entries
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

ALTER TABLE patient_portal_queue_entries
  ADD COLUMN IF NOT EXISTS closed_operating_date DATE;

ALTER TABLE patient_portal_queue_entries
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS clinic_queue_day_closures (
  id BIGSERIAL PRIMARY KEY,
  branch_id BIGINT NOT NULL REFERENCES clinic_branches (id),
  operating_date DATE NOT NULL,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (branch_id, operating_date)
);

CREATE INDEX IF NOT EXISTS clinic_queue_day_closures_date_idx
  ON clinic_queue_day_closures (operating_date DESC, branch_id);

CREATE INDEX IF NOT EXISTS patient_portal_queue_entries_needs_review_idx
  ON patient_portal_queue_entries (branch_id, user_id, checked_in_at DESC)
  WHERE status = 'needs_review';

DROP INDEX IF EXISTS patient_portal_queue_entries_active_appointment_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS patient_portal_queue_entries_active_appointment_uidx
  ON patient_portal_queue_entries (appointment_id)
  WHERE appointment_id IS NOT NULL
    AND status NOT IN ('completed', 'no_show', 'not_served', 'needs_review');
