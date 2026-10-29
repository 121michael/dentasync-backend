-- Preserve historical medical documents while introducing typed categories.
-- Legacy generic labels become Uncategorized; files themselves are not deleted.

UPDATE patient_portal_documents
SET category = 'Uncategorized'
WHERE document_type = 'medical_document'
  AND (
    category IS NULL
    OR btrim(category) = ''
    OR category = 'Medical clearance / supporting document'
  );

INSERT INTO clinic_service_durations (service_id, service_name, default_duration_minutes)
VALUES
  ('odontectomy', 'Odontectomy', 90),
  ('frenectomy', 'Frenectomy', 45),
  ('ortho-adjustment', 'Ortho Adjustment', 30),
  ('root-canal', 'Root Canal Treatment', 90),
  ('fixed-bridge', 'Fixed Bridge / Dental Crowns', 60)
ON CONFLICT (service_id) DO UPDATE
SET service_name = EXCLUDED.service_name,
    default_duration_minutes = EXCLUDED.default_duration_minutes,
    updated_at = CURRENT_TIMESTAMP;
