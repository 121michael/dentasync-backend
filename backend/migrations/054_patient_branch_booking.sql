-- Phase 3: optional appointment time and branch-scoped schedules.
-- Apply: npm run migrate:patient-branch-booking
-- Reverse: npm run migrate:patient-branch-booking:rollback
--
-- Existing appointment times stay as they are. New date-only bookings store NULL.
-- Rollback cannot put NOT NULL back while any saved time is NULL. Assign those
-- times first, or leave the column nullable. Appointments themselves are kept.
--
-- Existing clinic_schedule_days and clinic_schedule_slots rows are attached to
-- the Mandaluyong Main Branch. Other branches start from the same default hours
-- and keep their own closures, slot blocks, and booking counts.
--
-- Check-in limitation: the Mandaluyong RFID and QR readers do not send a branch.
-- Firmware is unchanged. A reader that cannot prove its branch checks in only
-- appointments already booked at the Main Branch. A patient whose appointment
-- is at another branch is sent to that branch's staffed desk. A walk-in with no
-- appointment still joins the Main Branch queue, because the reader has no
-- other branch to report.

ALTER TABLE patient_portal_appointments
  ALTER COLUMN appointment_time DROP NOT NULL;

UPDATE patient_portal_appointments AS appointment
SET branch_id = branch.id
FROM clinic_branches AS branch
WHERE branch.is_main
  AND appointment.branch_id IS NULL;

DO $migration$
BEGIN
  IF to_regclass('public.clinic_schedule_days') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE clinic_schedule_days ADD COLUMN IF NOT EXISTS branch_id BIGINT REFERENCES clinic_branches (id)';
  EXECUTE $sql$
    UPDATE clinic_schedule_days AS day
    SET branch_id = branch.id
    FROM clinic_branches AS branch
    WHERE branch.is_main
      AND day.branch_id IS NULL
  $sql$;

  IF EXISTS (SELECT 1 FROM clinic_schedule_days WHERE branch_id IS NULL) THEN
    RAISE EXCEPTION 'Clinic schedule days need the Main Branch before they can be scoped.';
  END IF;

  EXECUTE 'ALTER TABLE clinic_schedule_days ALTER COLUMN branch_id SET NOT NULL';
  EXECUTE 'ALTER TABLE clinic_schedule_days ALTER COLUMN branch_id SET DEFAULT clinic_main_branch_id()';

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'clinic_schedule_days'::regclass
      AND contype = 'p'
      AND pg_get_constraintdef(oid) LIKE '%branch_id%'
  ) THEN
    EXECUTE 'ALTER TABLE clinic_schedule_days DROP CONSTRAINT IF EXISTS clinic_schedule_days_pkey';
    EXECUTE 'ALTER TABLE clinic_schedule_days ADD PRIMARY KEY (branch_id, schedule_date)';
  END IF;
END
$migration$;

DO $migration$
BEGIN
  IF to_regclass('public.clinic_schedule_slots') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE clinic_schedule_slots ADD COLUMN IF NOT EXISTS branch_id BIGINT REFERENCES clinic_branches (id)';
  EXECUTE $sql$
    UPDATE clinic_schedule_slots AS slot
    SET branch_id = branch.id
    FROM clinic_branches AS branch
    WHERE branch.is_main
      AND slot.branch_id IS NULL
  $sql$;

  IF EXISTS (SELECT 1 FROM clinic_schedule_slots WHERE branch_id IS NULL) THEN
    RAISE EXCEPTION 'Clinic schedule slots need the Main Branch before they can be scoped.';
  END IF;

  EXECUTE 'ALTER TABLE clinic_schedule_slots ALTER COLUMN branch_id SET NOT NULL';
  EXECUTE 'ALTER TABLE clinic_schedule_slots ALTER COLUMN branch_id SET DEFAULT clinic_main_branch_id()';

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'clinic_schedule_slots'::regclass
      AND contype = 'p'
      AND pg_get_constraintdef(oid) LIKE '%branch_id%'
  ) THEN
    EXECUTE 'ALTER TABLE clinic_schedule_slots DROP CONSTRAINT IF EXISTS clinic_schedule_slots_pkey';
    EXECUTE 'ALTER TABLE clinic_schedule_slots ADD PRIMARY KEY (branch_id, schedule_date, slot_time)';
  END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS patient_portal_appointments_branch_day_active_idx
  ON patient_portal_appointments (branch_id, appointment_date)
  WHERE status IS DISTINCT FROM 'cancelled';
