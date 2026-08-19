-- Staff operations: billing/invoices and SMS delivery log for clinic front desk.

CREATE TABLE IF NOT EXISTS staff_portal_invoices (
  id BIGSERIAL PRIMARY KEY,
  invoice_code TEXT NOT NULL UNIQUE,
  patient_user_id TEXT,
  patient_name TEXT NOT NULL,
  patient_phone TEXT,
  appointment_id BIGINT,
  service_name TEXT NOT NULL,
  amount NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
  amount_paid NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  payment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'partially_paid', 'paid', 'cancelled')),
  notes TEXT,
  created_by TEXT,
  created_by_name TEXT,
  invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS staff_portal_invoices_date_idx
  ON staff_portal_invoices (invoice_date DESC, id DESC);

CREATE INDEX IF NOT EXISTS staff_portal_invoices_patient_idx
  ON staff_portal_invoices (patient_user_id, invoice_date DESC);

CREATE INDEX IF NOT EXISTS staff_portal_invoices_status_idx
  ON staff_portal_invoices (payment_status, invoice_date DESC);

CREATE TABLE IF NOT EXISTS staff_portal_sms_logs (
  id BIGSERIAL PRIMARY KEY,
  staff_user_id TEXT,
  patient_user_id TEXT,
  patient_phone TEXT,
  appointment_id BIGINT,
  queue_entry_id BIGINT,
  message_type TEXT NOT NULL,
  message_body TEXT NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending', 'sent', 'failed')),
  error_detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS staff_portal_sms_logs_created_idx
  ON staff_portal_sms_logs (created_at DESC);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS rfid_tag TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_rfid_tag_unique
  ON users (rfid_tag)
  WHERE rfid_tag IS NOT NULL AND BTRIM(rfid_tag) <> '';
