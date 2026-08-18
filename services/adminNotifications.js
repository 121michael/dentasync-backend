"use strict";

function notificationValue(value, maxLength = 500) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

async function notifyActiveAdmins(
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
       WHERE LOWER(role) = 'admin'
         AND is_verified = TRUE
         AND COALESCE(is_archived, FALSE) = FALSE
         AND LOWER(COALESCE(status, 'active')) NOT IN ('inactive', 'disabled', 'suspended')`
    );
    const adminIds = recipients.rows.map((admin) => String(admin.id));
    if (!adminIds.length) {
      return 0;
    }

    const result = await db.query(
      `INSERT INTO admin_portal_notifications (
         user_id, type, title, body, entity_type, entity_id
       )
       SELECT admin_id, $2, $3, $4, $5, $6
       FROM UNNEST($1::text[]) AS admin_id`,
      [
        adminIds,
        safeType,
        safeTitle,
        safeBody,
        entityType,
        entityId ? String(entityId) : null,
      ]
    );
    return result.rowCount || adminIds.length;
  } catch (error) {
    if (error.code === "42P01") {
      return 0;
    }
    throw error;
  }
}

module.exports = {
  notifyActiveAdmins,
};
