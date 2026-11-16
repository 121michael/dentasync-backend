-- Drops unused workstation challenges and the grant-duration setting.
-- Active grants, request rows, decisions, and audit history from 056 stay.

DROP TABLE IF EXISTS record_access_challenges;

DO $migration$
BEGIN
  IF to_regclass('public.admin_portal_settings') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE $sql$
    DELETE FROM admin_portal_settings WHERE setting_key = 'record_access_grant_minutes'
  $sql$;
END
$migration$;
