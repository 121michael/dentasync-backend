-- Reverse migrations/059_prescription_branch_scope.sql.
-- Deploy the previous application version before running this file.
-- Prescription rows, versions, signatures, email attempts, and stored PDF
-- files are kept. Originating-branch values and notification branch ids are
-- removed. They are not reconstructed from the dentist's current assignment.

DROP INDEX IF EXISTS staff_portal_notifications_branch_idx;
DROP INDEX IF EXISTS prescriptions_originating_branch_idx;

ALTER TABLE staff_portal_notifications DROP COLUMN IF EXISTS branch_id;
ALTER TABLE prescriptions DROP COLUMN IF EXISTS attribution_review;
ALTER TABLE prescriptions DROP COLUMN IF EXISTS originating_branch_id;
