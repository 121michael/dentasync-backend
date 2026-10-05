-- Optional source links for patient-portal notifications so inbox rows can
-- open the matching appointment or queue status.

ALTER TABLE patient_portal_notifications
  ADD COLUMN IF NOT EXISTS entity_type TEXT;

ALTER TABLE patient_portal_notifications
  ADD COLUMN IF NOT EXISTS entity_id TEXT;
