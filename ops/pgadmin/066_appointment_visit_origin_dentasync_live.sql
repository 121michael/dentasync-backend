-- DentaSync LIVE — pgAdmin handoff for visit origin only
-- Source: backend/migrations/066_appointment_visit_origin.sql (release 0fb2737 and later)
-- Target: the confirmed dentasync_db connection only.
-- Do not run every production migration. Do not run this on another database.
--
-- pgAdmin steps
-- 1. Confirm the Query Tool is connected to dentasync_db (not postgres, not a local copy).
-- 2. File → Open File… and open this file.
-- 3. Run SECTION A (preview) first. It is read-only.
-- 4. If the preview looks right, select SECTION B only and Execute (F5).
-- 5. If SECTION B reports an error, run ROLLBACK; then stop. Do not continue.
-- 6. Run SECTION C (verification). It is read-only.
--
-- What this does
-- Adds patient_portal_appointments.visit_origin when missing.
-- Backfills ONLY rows where visit_origin IS NULL.
-- Heuristic walk-in rows (Walk-in Consultation / RFID or QR auto-create notes / walk-in-* dentist ids)
-- become walk_in. Every remaining NULL row becomes booked.
-- Existing non-NULL visit_origin values are left unchanged.
-- RFID vs QR remains check_in_method, not visit type.

-- =============================================================================
-- SECTION A — read-only preview (safe to run repeatedly)
-- =============================================================================

SELECT current_database() AS connected_database,
       current_user AS connected_user;

SELECT EXISTS (
         SELECT 1
           FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'patient_portal_appointments'
       ) AS appointments_table_exists,
       EXISTS (
         SELECT 1
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'patient_portal_appointments'
            AND column_name = 'visit_origin'
       ) AS visit_origin_column_exists;

-- Rows that would be classified walk_in vs booked if visit_origin is still NULL
-- (uses the same heuristics as 066; does not change data).
SELECT COUNT(*)::bigint AS total_appointments,
       COUNT(*) FILTER (
         WHERE LOWER(BTRIM(COALESCE(service_name, ''))) = 'walk-in consultation'
            OR notes ILIKE '%Auto-created from RFID walk-in check-in%'
            OR notes ILIKE '%Auto-created from QR walk-in check-in%'
            OR dentist_id ILIKE 'walk-in-%'
       )::bigint AS would_classify_walk_in,
       COUNT(*) FILTER (
         WHERE NOT (
           LOWER(BTRIM(COALESCE(service_name, ''))) = 'walk-in consultation'
            OR notes ILIKE '%Auto-created from RFID walk-in check-in%'
            OR notes ILIKE '%Auto-created from QR walk-in check-in%'
            OR dentist_id ILIKE 'walk-in-%'
         )
       )::bigint AS would_classify_booked
  FROM patient_portal_appointments;

-- Current visit_origin counts only if the column already exists.
-- If the column is missing, this block prints a notice and does not fail.
DO $$
DECLARE
  rec RECORD;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'patient_portal_appointments'
       AND column_name = 'visit_origin'
  ) THEN
    RAISE NOTICE 'visit_origin is missing. That is the expected LIVE gap. Skip current-value counts until after SECTION B.';
    RETURN;
  END IF;

  SELECT COUNT(*) FILTER (WHERE visit_origin IS NULL)::bigint AS null_origin,
         COUNT(*) FILTER (WHERE visit_origin = 'walk_in')::bigint AS walk_in,
         COUNT(*) FILTER (WHERE visit_origin = 'booked')::bigint AS booked,
         COUNT(*) FILTER (
           WHERE visit_origin IS NOT NULL
             AND visit_origin NOT IN ('booked', 'walk_in')
         )::bigint AS unexpected_origin
    INTO rec
    FROM patient_portal_appointments;

  RAISE NOTICE 'Current visit_origin — null: %, walk_in: %, booked: %, unexpected: %',
    rec.null_origin, rec.walk_in, rec.booked, rec.unexpected_origin;
END $$;

-- =============================================================================
-- SECTION B — apply 066 (select this block only, then Execute)
-- Stop and run ROLLBACK; if this block errors.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'patient_portal_appointments'
  ) THEN
    RAISE EXCEPTION 'patient_portal_appointments is missing. Stop. This is not the 066-only setup.';
  END IF;
END $$;

ALTER TABLE patient_portal_appointments
  ADD COLUMN IF NOT EXISTS visit_origin TEXT;

UPDATE patient_portal_appointments
   SET visit_origin = 'walk_in'
 WHERE visit_origin IS NULL
   AND (
     LOWER(BTRIM(COALESCE(service_name, ''))) = 'walk-in consultation'
     OR notes ILIKE '%Auto-created from RFID walk-in check-in%'
     OR notes ILIKE '%Auto-created from QR walk-in check-in%'
     OR dentist_id ILIKE 'walk-in-%'
   );

UPDATE patient_portal_appointments
   SET visit_origin = 'booked'
 WHERE visit_origin IS NULL;

DO $$
BEGIN
  ALTER TABLE patient_portal_appointments
    ADD CONSTRAINT patient_portal_appointments_visit_origin_check
    CHECK (visit_origin IN ('booked', 'walk_in'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMIT;

-- =============================================================================
-- SECTION C — read-only verification
-- =============================================================================

SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'patient_portal_appointments'
   AND column_name = 'visit_origin';

SELECT conname, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
 WHERE conrelid = 'public.patient_portal_appointments'::regclass
   AND conname = 'patient_portal_appointments_visit_origin_check';

SELECT COUNT(*) FILTER (WHERE visit_origin IS NULL)::bigint AS remaining_null,
       COUNT(*) FILTER (WHERE visit_origin = 'walk_in')::bigint AS walk_in,
       COUNT(*) FILTER (WHERE visit_origin = 'booked')::bigint AS booked,
       COUNT(*) FILTER (
         WHERE visit_origin IS NOT NULL
           AND visit_origin NOT IN ('booked', 'walk_in')
       )::bigint AS unexpected_origin
  FROM patient_portal_appointments;
