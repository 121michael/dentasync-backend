-- Staff review confirmation is tied to a specific generated PDF of the
-- dentist-authorized version. Regenerating or changing versions clears it.

ALTER TABLE prescription_pdfs
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

ALTER TABLE prescription_pdfs
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT;

ALTER TABLE prescription_pdfs
  ADD COLUMN IF NOT EXISTS reviewed_content_hash TEXT;
