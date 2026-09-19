-- Data synchronization cleanup: one patient → one canonical record.
-- Safe, idempotent normalization only. Nothing is deleted except orphaned chart rows
-- whose parent patient record no longer exists.

-- 1. Canonical sex values on every table that stores them.
UPDATE clinic_patient_records
SET gender = CASE
  WHEN LOWER(BTRIM(gender)) IN ('m', 'male', 'lalaki') THEN 'Male'
  WHEN LOWER(BTRIM(gender)) IN ('f', 'female', 'babae') THEN 'Female'
  WHEN LOWER(BTRIM(gender)) IN ('non-binary', 'nonbinary', 'non_binary') THEN 'Non-binary'
  ELSE gender
END
WHERE gender IS NOT NULL
  AND gender <> CASE
    WHEN LOWER(BTRIM(gender)) IN ('m', 'male', 'lalaki') THEN 'Male'
    WHEN LOWER(BTRIM(gender)) IN ('f', 'female', 'babae') THEN 'Female'
    WHEN LOWER(BTRIM(gender)) IN ('non-binary', 'nonbinary', 'non_binary') THEN 'Non-binary'
    ELSE gender
  END;

UPDATE patient_portal_profiles
SET gender = CASE
  WHEN LOWER(BTRIM(gender)) IN ('m', 'male', 'lalaki') THEN 'Male'
  WHEN LOWER(BTRIM(gender)) IN ('f', 'female', 'babae') THEN 'Female'
  WHEN LOWER(BTRIM(gender)) IN ('non-binary', 'nonbinary', 'non_binary') THEN 'Non-binary'
  ELSE gender
END
WHERE gender IS NOT NULL
  AND gender <> CASE
    WHEN LOWER(BTRIM(gender)) IN ('m', 'male', 'lalaki') THEN 'Male'
    WHEN LOWER(BTRIM(gender)) IN ('f', 'female', 'babae') THEN 'Female'
    WHEN LOWER(BTRIM(gender)) IN ('non-binary', 'nonbinary', 'non_binary') THEN 'Non-binary'
    ELSE gender
  END;

-- 2. Canonical phone format (PH mobile 0XXXXXXXXXX → 63XXXXXXXXXX, digits only).
UPDATE clinic_patient_records
SET phone = CASE
  WHEN regexp_replace(phone, '\D', '', 'g') ~ '^0\d{10}$'
    THEN '63' || substr(regexp_replace(phone, '\D', '', 'g'), 2)
  ELSE regexp_replace(phone, '\D', '', 'g')
END
WHERE phone IS NOT NULL
  AND phone <> CASE
    WHEN regexp_replace(phone, '\D', '', 'g') ~ '^0\d{10}$'
      THEN '63' || substr(regexp_replace(phone, '\D', '', 'g'), 2)
    ELSE regexp_replace(phone, '\D', '', 'g')
  END;

-- 3. Link clinical records to patient accounts by exact email/phone when not yet linked,
--    so Dentist/Staff views read the profile as the single source of demographics.
UPDATE clinic_patient_records AS record
SET linked_user_id = account.id::text,
    updated_at = CURRENT_TIMESTAMP
FROM users AS account
WHERE record.linked_user_id IS NULL
  AND LOWER(account.role) = 'patient'
  AND COALESCE(account.is_archived, FALSE) = FALSE
  AND (
    (record.email IS NOT NULL AND LOWER(record.email) = LOWER(account.email))
    OR (record.phone IS NOT NULL AND record.phone = account.phone)
  );

-- 4. Patient ID / category flow from the account to its linked clinical records.
UPDATE clinic_patient_records AS record
SET patient_id = account.patient_id,
    patient_category = COALESCE(account.patient_category, record.patient_category),
    updated_at = CURRENT_TIMESTAMP
FROM users AS account
WHERE record.linked_user_id = account.id::text
  AND account.patient_id IS NOT NULL
  AND (record.patient_id IS DISTINCT FROM account.patient_id
       OR record.patient_category IS DISTINCT FROM COALESCE(account.patient_category, record.patient_category));

-- 5. Canonical treatment status codes.
UPDATE clinic_patient_treatments
SET status = LOWER(REPLACE(BTRIM(status), ' ', '_'))
WHERE status <> LOWER(REPLACE(BTRIM(status), ' ', '_'));

-- 6. Diagnosis is the clinical field; legacy notes-only rows are mirrored into diagnosis_notes.
UPDATE clinic_patient_treatments
SET diagnosis_notes = notes
WHERE (diagnosis_notes IS NULL OR BTRIM(diagnosis_notes) = '')
  AND notes IS NOT NULL
  AND BTRIM(notes) <> '';

-- 7. Remove chart rows that no longer belong to any patient record (defensive; FK normally cascades).
DELETE FROM clinic_dental_chart_entries AS chart
WHERE NOT EXISTS (
  SELECT 1 FROM clinic_patient_records AS record WHERE record.id = chart.clinical_record_id
);

-- 8. Relationship indexes used by every portal for the shared record.
CREATE INDEX IF NOT EXISTS clinic_patient_treatments_record_idx
  ON clinic_patient_treatments (clinical_record_id, treatment_date DESC, id DESC);

CREATE INDEX IF NOT EXISTS clinic_patient_treatments_appointment_idx
  ON clinic_patient_treatments (appointment_id)
  WHERE appointment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS patient_portal_appointments_user_date_idx
  ON patient_portal_appointments (user_id, appointment_date DESC, appointment_time DESC);

CREATE UNIQUE INDEX IF NOT EXISTS clinic_patient_records_patient_id_unique_idx
  ON clinic_patient_records (patient_id)
  WHERE patient_id IS NOT NULL AND COALESCE(is_archived, FALSE) = FALSE;
