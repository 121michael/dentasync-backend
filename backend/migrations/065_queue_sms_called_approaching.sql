-- Persist queue Called / approaching-turn SMS state so polling, concurrent jobs,
-- and restarts do not send the same visit notification twice.

ALTER TABLE patient_portal_queue_entries
  ADD COLUMN IF NOT EXISTS queue_sms_called_sent_at TIMESTAMPTZ;

ALTER TABLE patient_portal_queue_entries
  ADD COLUMN IF NOT EXISTS queue_sms_approaching_sent_at TIMESTAMPTZ;
