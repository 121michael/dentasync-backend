-- Patient portal data is isolated from the legacy tables so it can be
-- introduced safely into installations with differing appointment schemas.
-- `user_id` is text because existing installations use different numeric ID
-- types; the application always scopes every portal query to this value.

CREATE TABLE IF NOT EXISTS patient_portal_profiles (
  user_id TEXT PRIMARY KEY,
  date_of_birth DATE,
  gender TEXT,
  address TEXT,
  emergency_contact_name TEXT,
  emergency_contact_relationship TEXT,
  emergency_contact_phone TEXT,
  allergies TEXT,
  existing_conditions TEXT,
  current_medications TEXT,
  dental_concerns TEXT,
  hmo_provider TEXT,
  hmo_member_number TEXT,
  hmo_status TEXT NOT NULL DEFAULT 'not_enrolled',
  membership_tier TEXT NOT NULL DEFAULT 'Premium Patient',
  oral_health_score SMALLINT CHECK (oral_health_score BETWEEN 0 AND 100),
  last_cleaning DATE,
  next_checkup DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS patient_portal_preferences (
  user_id TEXT PRIMARY KEY,
  theme TEXT NOT NULL DEFAULT 'light' CHECK (theme IN ('light', 'dark')),
  notify_queue BOOLEAN NOT NULL DEFAULT FALSE,
  two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS patient_portal_appointments (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  service_name TEXT NOT NULL,
  dentist_id TEXT NOT NULL,
  dentist_name TEXT NOT NULL,
  appointment_date DATE NOT NULL,
  appointment_time TIME NOT NULL,
  clinic_location TEXT NOT NULL DEFAULT 'Amethyst Dental — Makati',
  coverage_type TEXT NOT NULL CHECK (coverage_type IN ('hmo', 'self_pay')),
  hmo_provider TEXT,
  hmo_member_number TEXT,
  authorization_document_id UUID,
  estimated_cost NUMERIC(10, 2) NOT NULL CHECK (estimated_cost >= 0),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('pending', 'confirmed', 'checked_in', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS patient_portal_appointments_user_date_idx
  ON patient_portal_appointments (user_id, appointment_date, appointment_time);

CREATE INDEX IF NOT EXISTS patient_portal_appointments_dentist_slot_idx
  ON patient_portal_appointments (dentist_id, appointment_date, appointment_time)
  WHERE status <> 'cancelled';

CREATE TABLE IF NOT EXISTS patient_portal_queue_entries (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  appointment_id BIGINT,
  token TEXT NOT NULL UNIQUE,
  position INTEGER NOT NULL CHECK (position > 0),
  status TEXT NOT NULL DEFAULT 'checked_in'
    CHECK (status IN ('checked_in', 'waiting', 'preparing', 'dentist', 'completed')),
  estimated_wait_minutes INTEGER NOT NULL DEFAULT 0 CHECK (estimated_wait_minutes >= 0),
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS patient_portal_queue_active_idx
  ON patient_portal_queue_entries (status, checked_in_at, position);

CREATE TABLE IF NOT EXISTS patient_portal_treatment_records (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  appointment_id BIGINT,
  treatment TEXT NOT NULL,
  dentist_name TEXT,
  clinic_location TEXT,
  coverage_status TEXT,
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('planned', 'in_progress', 'completed')),
  treatment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS patient_portal_records_user_date_idx
  ON patient_portal_treatment_records (user_id, treatment_date DESC);

CREATE TABLE IF NOT EXISTS patient_portal_documents (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  record_id BIGINT,
  document_type TEXT NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS patient_portal_documents_user_record_idx
  ON patient_portal_documents (user_id, record_id, created_at DESC);

CREATE TABLE IF NOT EXISTS patient_portal_notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS patient_portal_notifications_user_idx
  ON patient_portal_notifications (user_id, read_at, created_at DESC);

CREATE TABLE IF NOT EXISTS patient_portal_login_activity (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS patient_portal_login_activity_user_idx
  ON patient_portal_login_activity (user_id, created_at DESC);
