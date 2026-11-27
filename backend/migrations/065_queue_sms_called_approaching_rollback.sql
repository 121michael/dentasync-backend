ALTER TABLE patient_portal_queue_entries
  DROP COLUMN IF EXISTS queue_sms_approaching_sent_at;

ALTER TABLE patient_portal_queue_entries
  DROP COLUMN IF EXISTS queue_sms_called_sent_at;
