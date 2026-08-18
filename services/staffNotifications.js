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
  { type, title, body, entityType = null, entityId = null }
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

    const result = await db.query(
      `INSERT INTO staff_portal_notifications (
         user_id, type, title, body, entity_type, entity_id
       )
       SELECT staff_id, $2, $3, $4, $5, $6
       FROM UNNEST($1::text[]) AS staff_id`,
      [staffIds, safeType, safeTitle, safeBody, entityType, entityId ? String(entityId) : null]
    );

    return result.rowCount || staffIds.length;
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
