-- Up to three bookable services on one patient appointment.
-- One appointment row, one queue ticket. Duration is the sum of selected services.
-- Apply: npm run migrate:appointment-booking-services
-- Do not run from application startup. Do not apply on the live database from this agent.

ALTER TABLE patient_portal_appointments
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;

UPDATE patient_portal_appointments
SET duration_minutes = 30
WHERE duration_minutes IS NULL;

ALTER TABLE patient_portal_appointments
  ALTER COLUMN duration_minutes SET DEFAULT 30;

CREATE TABLE IF NOT EXISTS patient_portal_appointment_services (
  id BIGSERIAL PRIMARY KEY,
  appointment_id BIGINT NOT NULL REFERENCES patient_portal_appointments(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL,
  service_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  estimated_cost NUMERIC(12, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (appointment_id, service_id)
);

CREATE INDEX IF NOT EXISTS patient_portal_appointment_services_appointment_idx
  ON patient_portal_appointment_services (appointment_id, sort_order, id);

INSERT INTO patient_portal_appointment_services (
  appointment_id, service_id, service_name, sort_order, duration_minutes, estimated_cost
)
SELECT
  appointment.id,
  appointment.service_id,
  appointment.service_name,
  0,
  COALESCE(appointment.duration_minutes, 30),
  appointment.estimated_cost
FROM patient_portal_appointments AS appointment
WHERE appointment.service_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM patient_portal_appointment_services AS existing
    WHERE existing.appointment_id = appointment.id
  );
