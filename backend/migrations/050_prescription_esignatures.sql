-- One visual signature per prescription version.
-- The PNG is a clinic visual mark tied to the authenticated dentist and content hash.
-- It is not a cryptographic digital signature.

CREATE TABLE IF NOT EXISTS prescription_signatures (
  id UUID PRIMARY KEY,
  prescription_id UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  version_id UUID NOT NULL UNIQUE REFERENCES prescription_versions(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  dentist_id TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmation_phrase TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS prescription_signatures_prescription_idx
  ON prescription_signatures (prescription_id);
