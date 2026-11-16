-- Phase 5: cross-branch record requests and read-only grants.
-- Apply: npm run migrate:record-access
-- Reverse: npm run migrate:record-access:rollback
--
-- Existing patients, appointments, treatments, and branch assignments are kept.
-- A grant does not assign a dentist to a branch and does not open another
-- branch's appointments, check-ins, or queues.
--
-- Grant length is 30 minutes. An allowed configuration range, if Admin
-- configuration is added later, is 15 to 240 minutes. This migration does
-- not add that setting.
--
-- admin_portal_audit_logs has no retention period in the current schema.
-- That retention decision is unresolved and is left for clinic review.
-- Procedure consent remains a consent record. It does not grant chart access.
--
-- Legacy treatments with no originating branch are flagged for review.
-- Their branch is not guessed.

ALTER TABLE admin_portal_dentist_profiles
  ADD COLUMN IF NOT EXISTS can_approve_cross_branch_access BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE clinic_patient_treatments
  ADD COLUMN IF NOT EXISTS treating_dentist_id TEXT;

ALTER TABLE clinic_patient_treatments
  ADD COLUMN IF NOT EXISTS attribution_review BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE clinic_patient_treatments
SET attribution_review = TRUE
WHERE originating_branch_id IS NULL
  AND attribution_review = FALSE;

ALTER TABLE patient_portal_documents
  ADD COLUMN IF NOT EXISTS originating_branch_id BIGINT;

ALTER TABLE dental_wellness_assessments
  ADD COLUMN IF NOT EXISTS originating_branch_id BIGINT;

ALTER TABLE dental_procedure_authorizations
  ADD COLUMN IF NOT EXISTS originating_branch_id BIGINT;

CREATE TABLE IF NOT EXISTS record_access_requests (
  id BIGSERIAL PRIMARY KEY,
  clinical_record_id BIGINT NOT NULL,
  patient_user_id TEXT,
  requesting_dentist_id TEXT NOT NULL,
  requesting_branch_id BIGINT NOT NULL,
  originating_branch_id BIGINT NOT NULL,
  reason TEXT NOT NULL,
  scope TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at TIMESTAMPTZ,
  decided_by TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS record_access_requests_pending_uidx
  ON record_access_requests (requesting_dentist_id, clinical_record_id, originating_branch_id, scope)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS record_access_grants (
  id BIGSERIAL PRIMARY KEY,
  request_id BIGINT NOT NULL REFERENCES record_access_requests (id),
  requesting_dentist_id TEXT NOT NULL,
  clinical_record_id BIGINT NOT NULL,
  originating_branch_id BIGINT NOT NULL,
  scope TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'revoked')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS record_access_grants_active_uidx
  ON record_access_grants (requesting_dentist_id, clinical_record_id, originating_branch_id, scope)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS record_access_decisions (
  id BIGSERIAL PRIMARY KEY,
  request_id BIGINT NOT NULL REFERENCES record_access_requests (id),
  actor_id TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
