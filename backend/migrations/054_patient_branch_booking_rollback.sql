-- Reverse Phase 3 branch booking metadata.
-- Appointments, including rows saved with a NULL time, are not deleted.
-- appointment_time stays nullable when any date-only booking exists.
-- Putting NOT NULL back would require a real time on every row. This script
-- does not invent one.
-- Schedule rows that belong to a branch other than the Main Branch are removed
-- so the original date-only primary keys can be restored. Main Branch hours,
-- closures, and slot blocks stay.

DO $rollback$
DECLARE
  null_times INTEGER;
  main_id BIGINT;
BEGIN
  SELECT COUNT(*) INTO null_times
  FROM patient_portal_appointments
  WHERE appointment_time IS NULL;

  IF null_times = 0 THEN
    EXECUTE 'ALTER TABLE patient_portal_appointments ALTER COLUMN appointment_time SET NOT NULL';
  ELSE
    RAISE NOTICE 'Left appointment_time nullable because % appointment(s) have no time.', null_times;
  END IF;

  IF to_regclass('public.clinic_schedule_days') IS NULL THEN
    RETURN;
  END IF;

  SELECT id INTO main_id FROM clinic_branches WHERE is_main ORDER BY id LIMIT 1;

  IF main_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clinic_schedule_days' AND column_name = 'branch_id'
  ) THEN
    EXECUTE 'DELETE FROM clinic_schedule_slots WHERE branch_id IS DISTINCT FROM $1' USING main_id;
    EXECUTE 'DELETE FROM clinic_schedule_days WHERE branch_id IS DISTINCT FROM $1' USING main_id;
    EXECUTE 'ALTER TABLE clinic_schedule_slots DROP CONSTRAINT IF EXISTS clinic_schedule_slots_pkey';
    EXECUTE 'ALTER TABLE clinic_schedule_days DROP CONSTRAINT IF EXISTS clinic_schedule_days_pkey';
    EXECUTE 'ALTER TABLE clinic_schedule_slots DROP COLUMN IF EXISTS branch_id';
    EXECUTE 'ALTER TABLE clinic_schedule_days DROP COLUMN IF EXISTS branch_id';
    EXECUTE 'ALTER TABLE clinic_schedule_days ADD PRIMARY KEY (schedule_date)';
    EXECUTE 'ALTER TABLE clinic_schedule_slots ADD PRIMARY KEY (schedule_date, slot_time)';
  END IF;
END
$rollback$;

DROP INDEX IF EXISTS patient_portal_appointments_branch_day_active_idx;
