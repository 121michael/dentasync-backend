-- Dentist portal notification inbox. Complements staff/admin feeds without
-- duplicating appointment, queue, or patient records.

CREATE TABLE IF NOT EXISTS dentist_portal_notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS dentist_portal_notifications_user_idx
  ON dentist_portal_notifications (user_id, read_at, created_at DESC);
