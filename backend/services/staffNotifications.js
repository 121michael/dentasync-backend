"use strict";

function notificationValue(value, maxLength = 500) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

/**
 * Creates a notification for every active staff account. This intentionally
 * keeps the recipient list on the server so patient-facing requests never
 * decide which staff accounts can see clinic activity.
 */
async function notifyActiveStaff(
  db,
  { type, title, body, entityType = null, entityId = null, dedupe = false, branchId = null, unscoped = false }
) {
  const safeType = notificationValue(type, 80);
  const safeTitle = notificationValue(title, 180);
  const safeBody = notificationValue(body, 1000);

  if (!safeType || !safeTitle || !safeBody) {
    return 0;
  }

  const entity = String(entityType || "").toLowerCase();
  const prescriptionNotice = safeType === "prescription" || entity === "prescription";
  const operational =
    safeType === "appointment" ||
    safeType === "check_in" ||
    entity === "appointment" ||
    entity === "queue";
  if ((operational || (prescriptionNotice && !unscoped)) && (branchId == null || branchId === "")) {
    return 0;
  }

  try {
    const scopedBranchId =
      branchId == null || branchId === "" || (prescriptionNotice && unscoped) ? null : branchId;
    const recipients = scopedBranchId
      ? await db.query(
          `SELECT account.id
           FROM users AS account
           JOIN clinic_branch_assignments AS assignment
             ON assignment.user_id::text = account.id::text
           WHERE assignment.branch_id = $1
             AND LOWER(account.role) = 'staff'
             AND account.is_verified = TRUE
             AND COALESCE(account.is_archived, FALSE) = FALSE
             AND LOWER(COALESCE(account.status, 'active')) NOT IN ('inactive', 'disabled', 'suspended')`,
          [scopedBranchId]
        )
      : await db.query(
          `SELECT id
           FROM users
           WHERE LOWER(role) = 'staff'
             AND is_verified = TRUE
             AND COALESCE(is_archived, FALSE) = FALSE
             AND LOWER(COALESCE(status, 'active')) NOT IN ('inactive', 'disabled', 'suspended')`
        );
    const staffIds = recipients.rows.map((staff) => String(staff.id));

    if (!staffIds.length) {
      return 0;
    }

    const safeEntityType = entityType ? String(entityType) : null;
    const safeEntityId = entityId ? String(entityId) : null;
    const dedupeSql = dedupe
      ? `WHERE NOT EXISTS (
           SELECT 1
           FROM staff_portal_notifications AS existing
           WHERE existing.user_id = staff_id
             AND existing.type = $2
             AND existing.title = $3
             AND existing.body = $4
             AND existing.entity_type IS NOT DISTINCT FROM $5
             AND existing.entity_id IS NOT DISTINCT FROM $6
         )`
      : "";
    const noticeParams = [staffIds, safeType, safeTitle, safeBody, safeEntityType, safeEntityId];
    const insertSql = (includeBranch) =>
      `INSERT INTO staff_portal_notifications (
         user_id, type, title, body, entity_type, entity_id${includeBranch ? ", branch_id" : ""}
       )
       SELECT staff_id, $2, $3, $4, $5, $6${includeBranch ? ", $7" : ""}
       FROM UNNEST($1::text[]) AS staff_id
       ${dedupeSql}`;
    let result;
    try {
      result = await db.query(
        insertSql(scopedBranchId != null),
        scopedBranchId != null ? [...noticeParams, scopedBranchId] : noticeParams
      );
    } catch (insertError) {
      if (insertError.code !== "42703" || scopedBranchId == null) throw insertError;
      result = await db.query(insertSql(false), noticeParams);
    }

    if (Number.isInteger(result.rowCount)) return result.rowCount;
    return dedupe ? 0 : staffIds.length;
  } catch (error) {
    // Allow a rolling deployment to keep patient-facing workflows available
    // until the staff portal migration has run.
    if (error.code === "42P01") {
      return 0;
    }
    throw error;
  }
}

module.exports = {
  notifyActiveStaff,
};
