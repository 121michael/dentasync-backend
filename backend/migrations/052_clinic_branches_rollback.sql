-- Reverse migrations/052_clinic_branches.sql.
-- Accounts, credentials, roles, appointments, records, and backups are not modified.
-- Every branch and every personnel assignment is deleted, including branches
-- added after the migration and the seeded Mandaluyong Main Branch.

DROP TRIGGER IF EXISTS clinic_branch_assignments_enforce_trigger ON clinic_branch_assignments;
DROP TRIGGER IF EXISTS clinic_branches_protect_main_trigger ON clinic_branches;
DROP FUNCTION IF EXISTS clinic_branch_assignments_enforce();
DROP FUNCTION IF EXISTS clinic_branches_protect_main();
DROP TABLE IF EXISTS clinic_branch_assignments;
DROP TABLE IF EXISTS clinic_branches;
