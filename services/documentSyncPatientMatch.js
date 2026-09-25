"use strict";

const { withSavepoint } = require("./clinicalPatients");

function normalizePersonName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compactPersonName(value) {
  return normalizePersonName(value).replace(/\s+/g, "");
}

function displayName(row) {
  return `${row.first_name || ""} ${row.last_name || ""}`.trim();
}

function namesMatch(left, right) {
  const a = compactPersonName(left);
  const b = compactPersonName(right);
  return Boolean(a && b && a === b);
}

function inferPatientCategory(age) {
  const years = Number(String(age || "").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(years)) return "regular";
  if (years < 18) return "pediatric";
  if (years >= 60) return "senior";
  return "regular";
}

function mapCandidate(row, matchReason) {
  if (!row) return null;
  return {
    id: String(row.id),
    recordCode: row.record_code || null,
    patientId: row.patient_id || row.record_code || null,
    firstName: row.first_name || "",
    lastName: row.last_name || "",
    fullName: displayName(row),
    email: row.email || "",
    phone: row.phone || "",
    dateOfBirth: row.date_of_birth || null,
    matchReason,
  };
}

function uniqueCandidates(rows) {
  const seen = new Set();
  const out = [];
  for (const item of rows) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function phoneVariants(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  const variants = [];
  if (phone) variants.push(String(phone).trim());
  if (/^0\d{10}$/.test(digits)) variants.push(`63${digits.slice(1)}`);
  if (/^63\d{10}$/.test(digits)) variants.push(`0${digits.slice(2)}`);
  if (/^9\d{9}$/.test(digits)) {
    variants.push(`0${digits}`);
    variants.push(`63${digits}`);
  }
  return [...new Set(variants.filter(Boolean))];
}

const CANDIDATE_COLUMNS = {
  withPatientId:
    "id, record_code, patient_id, first_name, last_name, email, phone, date_of_birth, address, updated_at",
  legacy:
    "id, record_code, first_name, last_name, email, phone, date_of_birth, updated_at",
};

async function queryCandidates(client, savepoint, sqlWithId, sqlLegacy, params) {
  try {
    return await withSavepoint(client, savepoint, async () =>
      client.query(sqlWithId, params)
    );
  } catch (error) {
    if (error?.code !== "42703") {
      try {
        return await withSavepoint(client, `${savepoint}_legacy`, async () =>
          client.query(sqlLegacy, params)
        );
      } catch {
        return { rows: [] };
      }
    }
    try {
      return await withSavepoint(client, `${savepoint}_legacy`, async () =>
        client.query(sqlLegacy, params)
      );
    } catch {
      return { rows: [] };
    }
  }
}

/**
 * Find every reasonable existing patient for extracted identity.
 * Never returns only results[0] as an automatic merge target.
 * Queries use savepoints so a missing column cannot abort Confirm & Save.
 */
async function findMatchingClinicalPatients(client, patient = {}) {
  const candidates = [];
  const email = String(patient.email || "").trim().toLowerCase() || null;
  const phones = phoneVariants(patient.phone);
  const fullName = String(patient.fullName || `${patient.firstName || ""} ${patient.lastName || ""}`).trim();
  const compact = compactPersonName(fullName);

  if (email || phones.length) {
    const byContact = await queryCandidates(
      client,
      "match_by_contact",
      `SELECT ${CANDIDATE_COLUMNS.withPatientId}
       FROM clinic_patient_records
       WHERE COALESCE(is_archived, FALSE) = FALSE
         AND (
           ($1::text IS NOT NULL AND LOWER(email) = LOWER($1))
           OR ($2::text[] IS NOT NULL AND phone = ANY($2))
         )
       ORDER BY updated_at DESC
       LIMIT 25`,
      `SELECT ${CANDIDATE_COLUMNS.legacy}
       FROM clinic_patient_records
       WHERE COALESCE(is_archived, FALSE) = FALSE
         AND (
           ($1::text IS NOT NULL AND LOWER(email) = LOWER($1))
           OR ($2::text[] IS NOT NULL AND phone = ANY($2))
         )
       ORDER BY updated_at DESC
       LIMIT 25`,
      [email, phones.length ? phones : null]
    );
    for (const row of byContact.rows) {
      const reason =
        email && String(row.email || "").toLowerCase() === email ? "email" : "phone";
      candidates.push(mapCandidate(row, reason));
    }
  }

  if (compact) {
    const nameSql = (columns) =>
      `SELECT ${columns}
       FROM clinic_patient_records
       WHERE COALESCE(is_archived, FALSE) = FALSE
         AND regexp_replace(
           lower(trim(both from concat_ws(' ', first_name, last_name))),
           '[^a-z0-9]+',
           '',
           'g'
         ) = $1
       ORDER BY updated_at DESC
       LIMIT 25`;
    let nameRows = [];
    try {
      const byName = await withSavepoint(client, "match_by_name", async () =>
        client.query(nameSql(CANDIDATE_COLUMNS.withPatientId), [compact])
      );
      nameRows = byName.rows;
    } catch {
      try {
        const byName = await withSavepoint(client, "match_by_name_legacy", async () =>
          client.query(nameSql(CANDIDATE_COLUMNS.legacy), [compact])
        );
        nameRows = byName.rows;
      } catch {
        try {
          const fallback = await withSavepoint(client, "match_by_name_scan", async () =>
            client.query(
              `SELECT ${CANDIDATE_COLUMNS.legacy}
               FROM clinic_patient_records
               WHERE COALESCE(is_archived, FALSE) = FALSE
               ORDER BY updated_at DESC
               LIMIT 200`
            )
          );
          nameRows = fallback.rows.filter((row) => namesMatch(displayName(row), fullName));
        } catch {
          nameRows = [];
        }
      }
    }
    for (const row of nameRows) {
      if (namesMatch(displayName(row), fullName) || compactPersonName(displayName(row)) === compact) {
        candidates.push(mapCandidate(row, "normalized_name"));
      }
    }
  }

  const unique = uniqueCandidates(candidates);
  return {
    candidates: unique,
    matchReason: unique.length === 1 ? unique[0].matchReason : unique.length ? "multiple" : null,
  };
}

function findPatientConflicts(payload, record) {
  if (!record) return [];
  const existingDob = record.date_of_birth
    ? new Date(record.date_of_birth).toISOString().slice(0, 10)
    : record.dateOfBirth
      ? new Date(record.dateOfBirth).toISOString().slice(0, 10)
      : "";
  const compare = [
    { field: "Phone", documentValue: payload.phone, existingValue: record.phone },
    { field: "Date of Birth", documentValue: payload.dateOfBirth, existingValue: existingDob },
    { field: "Email", documentValue: payload.email, existingValue: record.email },
    { field: "Address", documentValue: payload.address, existingValue: record.address },
  ];
  return compare
    .filter(({ documentValue, existingValue }) => {
      let left = String(documentValue || "").trim().toLowerCase();
      let right = String(existingValue || "").trim().toLowerCase();
      if (!left || !right) return false;
      if (left.replace(/\D/g, "").length >= 10 && right.replace(/\D/g, "").length >= 10) {
        left = left.replace(/\D/g, "").replace(/^63/, "0");
        right = right.replace(/\D/g, "").replace(/^63/, "0");
      }
      return left !== right;
    })
    .map(({ field, documentValue, existingValue }) => ({
      field,
      documentValue: String(documentValue),
      existingValue: String(existingValue),
    }));
}

module.exports = {
  normalizePersonName,
  compactPersonName,
  namesMatch,
  inferPatientCategory,
  phoneVariants,
  findMatchingClinicalPatients,
  findPatientConflicts,
  mapCandidate,
};
