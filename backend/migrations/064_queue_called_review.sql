-- Called and previously-called visits go to dentist review at 6:00 PM Asia/Manila.
-- Waiting (never called) still cancels. Do not reopen cancelled rows.
-- Apply: npm run migrate:queue-day-closure
-- Do not run from application startup.

ALTER TABLE patient_portal_queue_entries
  ADD COLUMN IF NOT EXISTS called_at TIMESTAMPTZ;

ALTER TABLE patient_portal_queue_entries
  ADD COLUMN IF NOT EXISTS closure_from_status TEXT;

ALTER TABLE patient_portal_queue_entries
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT;

ALTER TABLE patient_portal_queue_entries
  ADD COLUMN IF NOT EXISTS review_outcome TEXT;

CREATE TABLE IF NOT EXISTS patient_portal_queue_status_events (
  id BIGSERIAL PRIMARY KEY,
  queue_entry_id BIGINT NOT NULL REFERENCES patient_portal_queue_entries (id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_id TEXT,
  actor_role TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS patient_portal_queue_status_events_queue_idx
  ON patient_portal_queue_status_events (queue_entry_id, created_at DESC);

-- Evidence of a call or chair start, without changing current status.
UPDATE patient_portal_queue_entries
SET called_at = COALESCE(called_at, updated_at)
WHERE called_at IS NULL
  AND status IN ('called', 'preparing', 'dentist', 'needs_review');

CREATE INDEX IF NOT EXISTS patient_portal_queue_entries_needs_review_open_idx
  ON patient_portal_queue_entries (branch_id, checked_in_at DESC)
  WHERE status = 'needs_review';
