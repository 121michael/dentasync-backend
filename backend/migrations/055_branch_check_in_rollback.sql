-- Reverse Phase 4 check-in metadata.
-- Appointments and queue tickets are kept. Date-only times stay NULL.
-- Dropping the reader row does not change the ESP32 firmware.

DROP INDEX IF EXISTS patient_portal_queue_entries_active_appointment_uidx;

ALTER TABLE staff_walkin_qr_sessions
  DROP COLUMN IF EXISTS branch_id;

DROP TABLE IF EXISTS clinic_rfid_readers;

DROP INDEX IF EXISTS clinic_branches_monitor_token_idx;

ALTER TABLE clinic_branches
  DROP COLUMN IF EXISTS monitor_token,
  DROP COLUMN IF EXISTS qr_enabled,
  DROP COLUMN IF EXISTS rfid_enabled;
