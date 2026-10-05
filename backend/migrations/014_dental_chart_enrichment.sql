-- Enrich existing clinic_dental_chart_entries for interactive FDI charting.
-- Extends paper-gap chart table; does not create a duplicate chart store.

ALTER TABLE clinic_dental_chart_entries
  ADD COLUMN IF NOT EXISTS tooth_status TEXT NOT NULL DEFAULT 'healthy',
  ADD COLUMN IF NOT EXISTS conditions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS treatments_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_by TEXT;

-- Backfill conditions_json from legacy condition_label when empty.
UPDATE clinic_dental_chart_entries
SET conditions_json = jsonb_build_array(condition_label)
WHERE (conditions_json IS NULL OR conditions_json = '[]'::jsonb)
  AND condition_label IS NOT NULL
  AND BTRIM(condition_label) <> '';

CREATE INDEX IF NOT EXISTS clinic_dental_chart_status_idx
  ON clinic_dental_chart_entries (clinical_record_id, tooth_status);
