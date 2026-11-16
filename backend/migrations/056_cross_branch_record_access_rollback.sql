-- Removes Phase 5 request and grant tables and the approval flag.
-- Treatments, patients, appointments, and existing audit rows are kept.
-- originating_branch_id values already stored on treatments are kept.
-- New attribution columns added by 056 are removed. Historical branch ids stay.

DROP TABLE IF EXISTS record_access_decisions;
DROP TABLE IF EXISTS record_access_grants;
DROP TABLE IF EXISTS record_access_requests;

ALTER TABLE dental_procedure_authorizations DROP COLUMN IF EXISTS originating_branch_id;
ALTER TABLE dental_wellness_assessments DROP COLUMN IF EXISTS originating_branch_id;
ALTER TABLE patient_portal_documents DROP COLUMN IF EXISTS originating_branch_id;
ALTER TABLE clinic_patient_treatments DROP COLUMN IF EXISTS attribution_review;
ALTER TABLE clinic_patient_treatments DROP COLUMN IF EXISTS treating_dentist_id;
ALTER TABLE admin_portal_dentist_profiles DROP COLUMN IF EXISTS can_approve_cross_branch_access;
