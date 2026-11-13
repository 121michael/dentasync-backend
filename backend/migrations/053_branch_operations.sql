-- Phase 2: keep appointments and queues inside a branch.
-- Apply: npm run migrate:branch-operations
-- Reverse: npm run migrate:branch-operations:rollback
--
-- Existing appointments and queue rows are assigned to the Mandaluyong Main Branch.
-- Account IDs, patient IDs, queue tokens, and row IDs stay as they are.
-- Rollback removes the branch columns and restores the previous queue counter key.
-- It does not delete appointments, queue rows, or patient records.
--
-- IoT dependency for a later phase: the current Mandaluyong RFID/QR readers do not
-- send a branch id. Staff desk check-in uses the signed-in staff member's branch.
-- A Pasig reader must identify its branch before firmware is changed. Until then,
-- reader and patient self check-in stay on the Main Branch.

ALTER TABLE patient_portal_appointments
  ADD COLUMN IF NOT EXISTS branch_id BIGINT REFERENCES clinic_branches (id);

ALTER TABLE patient_portal_queue_entries
  ADD COLUMN IF NOT EXISTS branch_id BIGINT REFERENCES clinic_branches (id);

ALTER TABLE clinic_patient_treatments
  ADD COLUMN IF NOT EXISTS originating_branch_id BIGINT REFERENCES clinic_branches (id);

ALTER TABLE clinic_daily_queue_counters
  ADD COLUMN IF NOT EXISTS branch_id BIGINT REFERENCES clinic_branches (id);

UPDATE patient_portal_appointments AS appointment
SET branch_id = branch.id
FROM clinic_branches AS branch
WHERE branch.is_main
  AND appointment.branch_id IS NULL;

UPDATE patient_portal_queue_entries AS queue
SET branch_id = appointment.branch_id
FROM patient_portal_appointments AS appointment
WHERE appointment.id = queue.appointment_id
  AND queue.branch_id IS NULL
  AND appointment.branch_id IS NOT NULL;

UPDATE patient_portal_queue_entries AS queue
SET branch_id = branch.id
FROM clinic_branches AS branch
WHERE branch.is_main
  AND queue.branch_id IS NULL;

UPDATE clinic_daily_queue_counters AS counter
SET branch_id = branch.id
FROM clinic_branches AS branch
WHERE branch.is_main
  AND counter.branch_id IS NULL;

CREATE INDEX IF NOT EXISTS patient_portal_appointments_branch_date_idx
  ON patient_portal_appointments (branch_id, appointment_date, appointment_time);

CREATE INDEX IF NOT EXISTS patient_portal_queue_branch_day_idx
  ON patient_portal_queue_entries (branch_id, checked_in_at, position);

ALTER TABLE patient_portal_queue_entries
  DROP CONSTRAINT IF EXISTS patient_portal_queue_entries_token_key;

DROP INDEX IF EXISTS patient_portal_queue_entries_token_day_idx;

CREATE UNIQUE INDEX IF NOT EXISTS patient_portal_queue_entries_token_branch_day_idx
  ON patient_portal_queue_entries (
    branch_id,
    ((checked_in_at AT TIME ZONE 'Asia/Manila')::date),
    token
  );

ALTER TABLE clinic_daily_queue_counters DROP CONSTRAINT IF EXISTS clinic_daily_queue_counters_pkey;

ALTER TABLE clinic_daily_queue_counters
  ADD CONSTRAINT clinic_daily_queue_counters_pkey PRIMARY KEY (clinic_date, prefix, branch_id);

CREATE OR REPLACE FUNCTION clinic_main_branch_id() RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT id FROM clinic_branches WHERE is_main ORDER BY id LIMIT 1
$$;

ALTER TABLE patient_portal_appointments
  ALTER COLUMN branch_id SET DEFAULT clinic_main_branch_id();

ALTER TABLE patient_portal_queue_entries
  ALTER COLUMN branch_id SET DEFAULT clinic_main_branch_id();
