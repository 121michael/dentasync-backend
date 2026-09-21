"use strict";

function notificationValue(value, maxLength = 500) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

async function listActiveDentists(db) {
  const result = await db.query(
    `SELECT
       account.id,
       account.first_name,
       account.last_name,
       profile.catalog_dentist_id
     FROM users AS account
     LEFT JOIN admin_portal_dentist_profiles AS profile
       ON profile.user_id = account.id
     WHERE LOWER(account.role) = 'dentist'
       AND account.is_verified = TRUE
       AND COALESCE(account.is_archived, FALSE) = FALSE
       AND LOWER(COALESCE(account.status, 'active')) NOT IN ('inactive', 'disabled', 'suspended')`
  );
  return result.rows;
}

function dentistMatchesAssignment(dentist, { dentistId = null, dentistName = null } = {}) {
  const idNeedle = dentistId != null && String(dentistId).trim() !== "" ? String(dentistId).trim().toLowerCase() : null;
  const nameNeedle =
    dentistName != null && String(dentistName).trim() !== "" ? String(dentistName).trim().toLowerCase() : null;

  if (!idNeedle && !nameNeedle) {
    return true;
  }

  const catalogId = String(dentist.catalog_dentist_id || "").trim().toLowerCase();
  const userId = String(dentist.id || "").trim().toLowerCase();
  const fullName = `${dentist.first_name || ""} ${dentist.last_name || ""}`.trim().toLowerCase();
  const displayName = fullName ? `dr. ${fullName}` : "";

  if (idNeedle && (catalogId === idNeedle || userId === idNeedle)) {
    return true;
  }
  if (nameNeedle && (fullName === nameNeedle || displayName === nameNeedle || nameNeedle === catalogId)) {
    return true;
  }
  return false;
}

async function resolveDentistRecipients(db, { dentistId = null, dentistName = null } = {}) {
  const dentists = await listActiveDentists(db);
  if (!dentists.length) {
    return [];
  }

  const assigned = dentists.filter((dentist) => dentistMatchesAssignment(dentist, { dentistId, dentistName }));
  if (assigned.length) {
    return assigned.map((dentist) => String(dentist.id));
  }

  // Walk-ins and unmatched catalog ids still need a chairside alert.
  if (dentistId || dentistName) {
    return dentists.map((dentist) => String(dentist.id));
  }

  return dentists.map((dentist) => String(dentist.id));
}

async function notifyDentists(
  db,
  { type, title, body, entityType = null, entityId = null, dentistId = null, dentistName = null }
) {
  const safeType = notificationValue(type, 80);
  const safeTitle = notificationValue(title, 180);
  const safeBody = notificationValue(body, 1000);
  if (!safeType || !safeTitle || !safeBody) {
    return 0;
  }

  try {
    const dentistIds = await resolveDentistRecipients(db, { dentistId, dentistName });
    if (!dentistIds.length) {
      return 0;
    }

    const result = await db.query(
      `INSERT INTO dentist_portal_notifications (
         user_id, type, title, body, entity_type, entity_id
       )
       SELECT dentist_id, $2, $3, $4, $5, $6
       FROM UNNEST($1::text[]) AS dentist_id`,
      [
        dentistIds,
        safeType,
        safeTitle,
        safeBody,
        entityType,
        entityId ? String(entityId) : null,
      ]
    );
    return result.rowCount || dentistIds.length;
  } catch (error) {
    if (error.code === "42P01" || error.code === "42703") {
      return 0;
    }
    throw error;
  }
}

module.exports = {
  notifyDentists,
  dentistMatchesAssignment,
  resolveDentistRecipients,
};
