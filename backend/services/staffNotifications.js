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
  { type, title, body, entityType = null, entityId = null, dedupe = false }
) {
  const safeType = notificationValue(type, 80);
  const safeTitle = notificationValue(title, 180);
  const safeBody = notificationValue(body, 1000);

  if (!safeType || !safeTitle || !safeBody) {
    return 0;
  }

  try {
    const recipients = await db.query(
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
    const result = await db.query(
      `INSERT INTO staff_portal_notifications (
         user_id, type, title, body, entity_type, entity_id
       )
       SELECT staff_id, $2, $3, $4, $5, $6
       FROM UNNEST($1::text[]) AS staff_id
       ${dedupeSql}`,
      [staffIds, safeType, safeTitle, safeBody, safeEntityType, safeEntityId]
    );

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
