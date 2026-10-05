"use strict";

async function insertPatientNotification(
  client,
  { userId, type, title, body, entityType = null, entityId = null }
) {
  const id = userId != null ? String(userId) : "";
  if (!id || !type || !title || !body) {
    return 0;
  }

  try {
    await client.query(
      `INSERT INTO patient_portal_notifications (
         user_id, type, title, body, entity_type, entity_id
       )
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, type, title, body, entityType || null, entityId != null ? String(entityId) : null]
    );
    return 1;
  } catch (error) {
    if (error.code === "42703") {
      await client.query(
        `INSERT INTO patient_portal_notifications (user_id, type, title, body)
         VALUES ($1, $2, $3, $4)`,
        [id, type, title, body]
      );
      return 1;
    }
    if (error.code === "42P01") {
      return 0;
    }
    throw error;
  }
}

function mapPatientNotification(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    entityType: row.entity_type || null,
    entityId: row.entity_id || null,
    read: Boolean(row.read_at || row.readAt),
    readAt: row.read_at || row.readAt || null,
    createdAt: row.created_at || row.createdAt,
  };
}

module.exports = {
  insertPatientNotification,
  mapPatientNotification,
};
