-- Daily per-category queue numbers (A-001, S-001, P-001, W-001).
-- Queue numbers may repeat on later clinic days; they are unique per clinic date.
-- Historical tokens are kept as stored. Permanent Patient IDs are unchanged.

CREATE TABLE IF NOT EXISTS clinic_daily_queue_counters (
  clinic_date DATE NOT NULL,
  prefix TEXT NOT NULL CHECK (prefix IN ('A', 'S', 'P', 'W')),
  last_sequence INTEGER NOT NULL CHECK (last_sequence > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (clinic_date, prefix)
);

ALTER TABLE patient_portal_queue_entries
  DROP CONSTRAINT IF EXISTS patient_portal_queue_entries_token_key;

DROP INDEX IF EXISTS patient_portal_queue_entries_token_key;

CREATE UNIQUE INDEX IF NOT EXISTS patient_portal_queue_entries_token_day_idx
  ON patient_portal_queue_entries (
    ((checked_in_at AT TIME ZONE 'Asia/Manila')::date),
    token
  );

COMMENT ON TABLE clinic_daily_queue_counters IS
  'Per-category daily queue sequences. Independent of permanent clinic Patient IDs.';
