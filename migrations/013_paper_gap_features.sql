-- Paper-gap features: extend existing schema only where needed.

-- HMO booking fields staff already expects
ALTER TABLE patient_portal_appointments
  ADD COLUMN IF NOT EXISTS hmo_company_name TEXT,
  ADD COLUMN IF NOT EXISTS hmo_birth_date DATE,
  ADD COLUMN IF NOT EXISTS hmo_verification_status TEXT NOT NULL DEFAULT 'not_applicable';

ALTER TABLE patient_portal_profiles
  ADD COLUMN IF NOT EXISTS company_name TEXT,
  ADD COLUMN IF NOT EXISTS birth_date DATE;

-- Staff notification action workflow
ALTER TABLE staff_portal_notifications
  ADD COLUMN IF NOT EXISTS action_status TEXT NOT NULL DEFAULT 'pending';

-- Clinical treatment detail fields
ALTER TABLE clinic_patient_treatments
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS tooth_number TEXT,
  ADD COLUMN IF NOT EXISTS diagnosis_notes TEXT,
  ADD COLUMN IF NOT EXISTS procedure_details TEXT;

-- Service default durations for wait estimates
CREATE TABLE IF NOT EXISTS clinic_service_durations (
  service_id TEXT PRIMARY KEY,
  service_name TEXT NOT NULL,
  default_duration_minutes INTEGER NOT NULL DEFAULT 45 CHECK (default_duration_minutes > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO clinic_service_durations (service_id, service_name, default_duration_minutes)
VALUES
  ('cleaning', 'Dental Cleaning', 45),
  ('extraction', 'Tooth Extraction', 60),
  ('filling', 'Dental Filling', 45),
  ('root-canal', 'Root Canal', 90),
  ('orthodontic-consultation', 'Orthodontic Consultation', 30),
  ('whitening', 'Teeth Whitening', 60),
  ('general-consultation', 'General Consultation', 30),
  ('emergency-care', 'Emergency Dental Care', 45)
ON CONFLICT (service_id) DO NOTHING;

-- 2D dental chart entries
CREATE TABLE IF NOT EXISTS clinic_dental_chart_entries (
  id BIGSERIAL PRIMARY KEY,
  clinical_record_id BIGINT NOT NULL REFERENCES clinic_patient_records(id) ON DELETE CASCADE,
  tooth_number TEXT NOT NULL,
  condition_label TEXT NOT NULL,
  notes TEXT,
  created_by TEXT,
  created_by_role TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (clinical_record_id, tooth_number)
);

CREATE INDEX IF NOT EXISTS clinic_dental_chart_record_idx
  ON clinic_dental_chart_entries (clinical_record_id);

-- Family / dependent links (guardian manages dependents)
CREATE TABLE IF NOT EXISTS patient_portal_dependents (
  id BIGSERIAL PRIMARY KEY,
  guardian_user_id TEXT NOT NULL,
  dependent_user_id TEXT NOT NULL,
  relationship TEXT NOT NULL DEFAULT 'dependent',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (guardian_user_id, dependent_user_id),
  CHECK (guardian_user_id <> dependent_user_id)
);

CREATE INDEX IF NOT EXISTS patient_portal_dependents_guardian_idx
  ON patient_portal_dependents (guardian_user_id);

-- Staff identity verification for clinical patient records
ALTER TABLE clinic_patient_records
  ADD COLUMN IF NOT EXISTS staff_verification_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS staff_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS staff_verified_by TEXT;

-- Optional X-ray analysis results (populated only when real analysis is configured)
CREATE TABLE IF NOT EXISTS patient_xray_analyses (
  id BIGSERIAL PRIMARY KEY,
  document_id UUID NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unavailable'
    CHECK (status IN ('pending', 'completed', 'unavailable', 'failed')),
  summary TEXT,
  findings_json JSONB,
  confidence NUMERIC(5, 2),
  disclaimer TEXT NOT NULL DEFAULT 'Preliminary / supplementary information only. Not a clinical diagnosis.',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS patient_xray_analyses_user_idx
  ON patient_xray_analyses (user_id, created_at DESC);
