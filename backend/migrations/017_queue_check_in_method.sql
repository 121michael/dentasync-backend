-- Optional audit field for how a patient entered the central queue.
ALTER TABLE patient_portal_queue_entries
  ADD COLUMN IF NOT EXISTS check_in_method TEXT;

CREATE INDEX IF NOT EXISTS patient_portal_queue_entries_method_idx
  ON patient_portal_queue_entries (check_in_method)
  WHERE check_in_method IS NOT NULL;
