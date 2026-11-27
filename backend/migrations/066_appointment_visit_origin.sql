-- Authoritative visit origin: booked vs walk-in. Check-in method (RFID/QR) is not visit type.

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
