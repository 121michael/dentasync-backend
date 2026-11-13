-- Reverse migrations/053_branch_operations.sql.
-- Appointments, queue rows, treatments, accounts, and patient IDs are kept.
-- Branch association columns are removed. Queue numbers return to one daily
-- sequence per category for the whole clinic. Branches and assignments from
-- Phase 1 are not removed.

DROP INDEX IF EXISTS patient_portal_queue_entries_token_branch_day_idx;

ALTER TABLE clinic_daily_queue_counters DROP CONSTRAINT IF EXISTS clinic_daily_queue_counters_pkey;

ALTER TABLE clinic_daily_queue_counters DROP COLUMN IF EXISTS branch_id;

ALTER TABLE clinic_daily_queue_counters
  ADD CONSTRAINT clinic_daily_queue_counters_pkey PRIMARY KEY (clinic_date, prefix);

CREATE UNIQUE INDEX IF NOT EXISTS patient_portal_queue_entries_token_day_idx
  ON patient_portal_queue_entries (
    ((checked_in_at AT TIME ZONE 'Asia/Manila')::date),
    token
  );

ALTER TABLE patient_portal_queue_entries ALTER COLUMN branch_id DROP DEFAULT;
ALTER TABLE patient_portal_appointments ALTER COLUMN branch_id DROP DEFAULT;
DROP FUNCTION IF EXISTS clinic_main_branch_id();

ALTER TABLE clinic_patient_treatments DROP COLUMN IF EXISTS originating_branch_id;
ALTER TABLE patient_portal_queue_entries DROP COLUMN IF EXISTS branch_id;
ALTER TABLE patient_portal_appointments DROP COLUMN IF EXISTS branch_id;
