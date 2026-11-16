-- Drops unused approval codes. Grants, requests, decisions, and audit stay.

DROP INDEX IF EXISTS record_access_challenges_code_open_uidx;

ALTER TABLE record_access_challenges
  DROP COLUMN IF EXISTS approval_code;
