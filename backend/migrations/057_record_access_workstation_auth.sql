-- Phase 5 workstation authorization: short-lived single-use challenges
-- and Admin-configured grant duration (15–240 minutes, default 30).
-- Apply after 056_cross_branch_record_access.sql via npm run migrate:record-access.
-- Reverse: npm run migrate:record-access:rollback (057 then 056).
--
-- Existing grants, pending requests, decisions, and audit rows are kept.
-- New access is authorized at the requesting workstation. A legacy pending
-- request does not become a grant until a fresh challenge is consumed.
-- Rolling back 057 drops unused challenges and the duration setting only.

CREATE TABLE IF NOT EXISTS record_access_challenges (
  id BIGSERIAL PRIMARY KEY,
  clinical_record_id BIGINT NOT NULL,
  patient_user_id TEXT,
  requesting_dentist_id TEXT NOT NULL,
  requesting_branch_id BIGINT NOT NULL,
  originating_branch_id BIGINT NOT NULL,
  reason TEXT NOT NULL,
  scope TEXT NOT NULL,
  legacy_request_id BIGINT REFERENCES record_access_requests (id),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS record_access_challenges_open_idx
  ON record_access_challenges (requesting_dentist_id, clinical_record_id, originating_branch_id, scope)
  WHERE consumed_at IS NULL;

DO $migration$
BEGIN
  IF to_regclass('public.admin_portal_settings') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE $sql$
    INSERT INTO admin_portal_settings (setting_key, setting_value)
    VALUES ('record_access_grant_minutes', '30'::jsonb)
    ON CONFLICT (setting_key) DO NOTHING
  $sql$;
END
$migration$;
