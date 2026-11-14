-- Phase 4: branch check-in methods and one queue entry per appointment.
-- Apply: npm run migrate:branch-check-in
-- Reverse: npm run migrate:branch-check-in:rollback
--
-- Existing appointments, including date-only rows, are not rewritten.
-- A date-only time stays NULL. Rollback does not invent a time and does not
-- delete queue tickets.
--
-- Late arrival, grace period, and automatic no-show are not defined in the
-- stored clinic rules. This migration does not add a cutoff.
--
-- The Mandaluyong ESP32 stays the one authorized reader. Firmware is unchanged
-- and still does not send a branch. The reader row below is the branch source.

ALTER TABLE clinic_branches
  ADD COLUMN IF NOT EXISTS rfid_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS qr_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS monitor_token TEXT;

UPDATE clinic_branches
SET rfid_enabled = TRUE,
    qr_enabled = TRUE
WHERE is_main;

UPDATE clinic_branches
SET rfid_enabled = FALSE,
    qr_enabled = TRUE
WHERE is_main = FALSE
  AND (LOWER(name) = 'pasig' OR branch_code = 'BR-0002');

UPDATE clinic_branches
SET monitor_token = md5(branch_code || ':' || id::text || ':' || clock_timestamp()::text)
WHERE monitor_token IS NULL OR BTRIM(monitor_token) = '';

CREATE UNIQUE INDEX IF NOT EXISTS clinic_branches_monitor_token_idx
  ON clinic_branches (monitor_token);

CREATE TABLE IF NOT EXISTS clinic_rfid_readers (
  id BIGSERIAL PRIMARY KEY,
  branch_id BIGINT NOT NULL REFERENCES clinic_branches (id),
  label TEXT NOT NULL DEFAULT 'Desk reader',
  authorized BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO clinic_rfid_readers (branch_id, label, authorized)
SELECT branch.id, 'Mandaluyong ESP32', TRUE
FROM clinic_branches AS branch
WHERE branch.is_main
  AND NOT EXISTS (
    SELECT 1 FROM clinic_rfid_readers AS reader WHERE reader.authorized = TRUE
  );

ALTER TABLE staff_walkin_qr_sessions
  ADD COLUMN IF NOT EXISTS branch_id BIGINT REFERENCES clinic_branches (id);

CREATE INDEX IF NOT EXISTS staff_walkin_qr_sessions_branch_idx
  ON staff_walkin_qr_sessions (branch_id);

DO $queue_guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM patient_portal_queue_entries
    WHERE appointment_id IS NOT NULL
      AND status NOT IN ('completed', 'no_show')
    GROUP BY appointment_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE NOTICE 'Skipped the one-active-queue index because duplicate active entries already exist.';
    RETURN;
  END IF;

  EXECUTE $sql$
    CREATE UNIQUE INDEX IF NOT EXISTS patient_portal_queue_entries_active_appointment_uidx
    ON patient_portal_queue_entries (appointment_id)
    WHERE appointment_id IS NOT NULL
      AND status NOT IN ('completed', 'no_show')
  $sql$;
END
$queue_guard$;
