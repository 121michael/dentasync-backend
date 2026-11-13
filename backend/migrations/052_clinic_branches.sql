-- Phase 1 branch management.
-- Apply: npm run migrate:clinic-branches
-- Reverse: npm run migrate:clinic-branches:rollback
--
-- Rollback drops clinic_branch_assignments and clinic_branches. User accounts,
-- passwords, roles, and every other clinic record stay as they are. Branches
-- and assignments created after this migration, including Pasig or any other
-- added branch, are removed. Personnel return to having no branch metadata.

CREATE TABLE IF NOT EXISTS clinic_branches (
  id BIGSERIAL PRIMARY KEY,
  branch_code TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  contact_number TEXT NOT NULL DEFAULT '',
  email TEXT,
  is_main BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT clinic_branches_status_check CHECK (status IN ('active', 'inactive')),
  CONSTRAINT clinic_branches_main_active_check CHECK (NOT is_main OR status = 'active')
);

CREATE UNIQUE INDEX IF NOT EXISTS clinic_branches_code_unique
  ON clinic_branches (branch_code);

CREATE UNIQUE INDEX IF NOT EXISTS clinic_branches_one_main
  ON clinic_branches ((TRUE))
  WHERE is_main;

CREATE TABLE IF NOT EXISTS clinic_branch_assignments (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  branch_id BIGINT NOT NULL REFERENCES clinic_branches (id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT clinic_branch_assignments_unique UNIQUE (user_id, branch_id)
);

CREATE INDEX IF NOT EXISTS clinic_branch_assignments_branch_idx
  ON clinic_branch_assignments (branch_id);

CREATE OR REPLACE FUNCTION clinic_branches_protect_main() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_main THEN
      RAISE EXCEPTION 'The Main Branch cannot be deleted.' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.is_main AND NOT NEW.is_main THEN
    RAISE EXCEPTION 'The Main Branch cannot lose its main designation.' USING ERRCODE = '23514';
  END IF;

  IF OLD.is_main AND NEW.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'The Main Branch cannot be deactivated.' USING ERRCODE = '23514';
  END IF;

  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS clinic_branches_protect_main_trigger ON clinic_branches;
CREATE TRIGGER clinic_branches_protect_main_trigger
  BEFORE UPDATE OR DELETE ON clinic_branches
  FOR EACH ROW
  EXECUTE FUNCTION clinic_branches_protect_main();

CREATE OR REPLACE FUNCTION clinic_branch_assignments_enforce() RETURNS trigger AS $$
DECLARE
  account_role TEXT;
  branch_status TEXT;
  existing_count INTEGER;
BEGIN
  SELECT LOWER(role) INTO account_role FROM users WHERE id = NEW.user_id;
  IF account_role IS NULL THEN
    RAISE EXCEPTION 'Branch assignment requires an existing account.' USING ERRCODE = '23503';
  END IF;
  IF account_role NOT IN ('staff', 'dentist') THEN
    RAISE EXCEPTION 'Only staff and dentists can be assigned to a branch.' USING ERRCODE = '23514';
  END IF;

  SELECT status INTO branch_status FROM clinic_branches WHERE id = NEW.branch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Branch not found.' USING ERRCODE = '23503';
  END IF;

  IF TG_OP = 'INSERT' AND branch_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'New assignments require an active branch.' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.branch_id IS DISTINCT FROM OLD.branch_id AND branch_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'New assignments require an active branch.' USING ERRCODE = '23514';
  END IF;

  IF account_role = 'staff' THEN
    SELECT COUNT(*) INTO existing_count
    FROM clinic_branch_assignments
    WHERE user_id = NEW.user_id
      AND id IS DISTINCT FROM COALESCE(NEW.id, 0);
    IF existing_count > 0 THEN
      RAISE EXCEPTION 'Staff must be assigned to exactly one branch.' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS clinic_branch_assignments_enforce_trigger ON clinic_branch_assignments;
CREATE TRIGGER clinic_branch_assignments_enforce_trigger
  BEFORE INSERT OR UPDATE ON clinic_branch_assignments
  FOR EACH ROW
  EXECUTE FUNCTION clinic_branch_assignments_enforce();

-- Existing clinic contact from frontend/src/legal/dentasyncLegal.js.
-- Nothing else is filled in. Re-running the migration does not add a second main branch.
INSERT INTO clinic_branches (branch_code, name, address, contact_number, email, is_main, status)
SELECT
  'BR-0001',
  'Mandaluyong',
  'Grand Central Residences, Cityland, Sultan St., Highway Hills, Mandaluyong, Metro Manila',
  '09109207877',
  'amethystdental@gmail.com',
  TRUE,
  'active'
WHERE NOT EXISTS (SELECT 1 FROM clinic_branches WHERE is_main);

INSERT INTO clinic_branch_assignments (user_id, branch_id)
SELECT account.id, branch.id
FROM users AS account
JOIN clinic_branches AS branch ON branch.is_main
WHERE LOWER(account.role) IN ('staff', 'dentist')
  AND NOT EXISTS (
    SELECT 1 FROM clinic_branch_assignments AS existing
    WHERE existing.user_id = account.id
  );
