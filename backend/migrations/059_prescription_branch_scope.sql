-- Keep prescription processing inside the branch where the prescription originated.
-- Apply after 050_prescription_esignatures.sql, 052_clinic_branches.sql, and
-- 053_branch_operations.sql:
--   npm run migrate:prescription-branches
-- Reverse only after the previous application code is deployed:
--   npm run migrate:prescription-branches:rollback
--
-- The migration adds originating_branch_id and attribution_review. It does not
-- delete prescriptions, versions, signatures, PDF rows, or signed files.
-- A dentist's later branch assignment is not copied onto old prescriptions.
-- Only a linked appointment branch or linked treatment branch is backfilled,
-- and only when those sources agree. Conflicting or missing links stay
-- unattributed for Admin review and are not placed in a branch queue.
-- Re-applying the migration fills still-unknown rows; it does not move a
-- prescription that already has a branch.
--
-- Rollback drops the two prescription columns and staff_portal_notifications.branch_id.
-- Prescription rows and signed files remain. Branch attribution stored only in
-- those columns is removed. Re-applying restores appointment and treatment
-- links, not a branch that was taken from the dentist's assignment at creation
-- time. Run the application rollback first. The scoped notification queries
-- reference staff_portal_notifications.branch_id and fail if that column is
-- dropped while this application version is still running.

ALTER TABLE prescriptions
  ADD COLUMN IF NOT EXISTS originating_branch_id BIGINT REFERENCES clinic_branches (id);

ALTER TABLE prescriptions
  ADD COLUMN IF NOT EXISTS attribution_review BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE staff_portal_notifications
  ADD COLUMN IF NOT EXISTS branch_id BIGINT;

UPDATE prescriptions AS rx
SET originating_branch_id = src.branch_id,
    attribution_review = FALSE
FROM (
  SELECT
    prescription.id,
    CASE
      WHEN appointment.branch_id IS NOT NULL
       AND treatment.originating_branch_id IS NOT NULL
       AND appointment.branch_id = treatment.originating_branch_id
        THEN appointment.branch_id
      WHEN appointment.branch_id IS NOT NULL
       AND treatment.originating_branch_id IS NOT NULL
       AND appointment.branch_id IS DISTINCT FROM treatment.originating_branch_id
        THEN NULL
      WHEN appointment.branch_id IS NOT NULL
       AND (
         prescription.treatment_id IS NULL
         OR treatment.id IS NULL
         OR treatment.originating_branch_id IS NULL
       )
        THEN appointment.branch_id
      WHEN treatment.originating_branch_id IS NOT NULL
       AND (
         prescription.appointment_id IS NULL
         OR appointment.id IS NULL
         OR appointment.branch_id IS NULL
       )
        THEN treatment.originating_branch_id
      ELSE NULL
    END AS branch_id
  FROM prescriptions AS prescription
  LEFT JOIN patient_portal_appointments AS appointment
    ON appointment.id = prescription.appointment_id
  LEFT JOIN clinic_patient_treatments AS treatment
    ON treatment.id = prescription.treatment_id
) AS src
WHERE rx.id = src.id
  AND rx.originating_branch_id IS NULL
  AND src.branch_id IS NOT NULL;

UPDATE prescriptions
SET attribution_review = TRUE
WHERE originating_branch_id IS NULL
  AND attribution_review = FALSE;

CREATE INDEX IF NOT EXISTS prescriptions_originating_branch_idx
  ON prescriptions (originating_branch_id, workflow_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS staff_portal_notifications_branch_idx
  ON staff_portal_notifications (user_id, branch_id, created_at DESC);
