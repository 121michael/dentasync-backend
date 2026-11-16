-- Phase 5 isolated approver: workstation approval codes identify a challenge
-- without granting access. Apply after 057 via npm run migrate:record-access.
-- Reverse: npm run migrate:record-access:rollback (058, 057, then 056).
--
-- Existing grants, pending requests, decisions, and audit rows are kept.
-- Approval codes are identifiers only. They do not authenticate anyone.

ALTER TABLE record_access_challenges
  ADD COLUMN IF NOT EXISTS approval_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS record_access_challenges_code_open_uidx
  ON record_access_challenges (approval_code)
  WHERE approval_code IS NOT NULL AND consumed_at IS NULL;
