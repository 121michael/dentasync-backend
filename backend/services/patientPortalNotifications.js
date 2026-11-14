"use strict";

async function insertPatientNotification(
  client,
  { userId, type, title, body, entityType = null, entityId = null }
) {
  const id = userId != null ? String(userId) : "";
  if (!id || !type || !title || !body) {
    return 0;
  }

  const params = [id, type, title, body, entityType || null, entityId != null ? String(entityId) : null];
  const fullSql = `INSERT INTO patient_portal_notifications (
         user_id, type, title, body, entity_type, entity_id
       ) VALUES ($1, $2, $3, $4, $5, $6)`;
  const shortSql = `INSERT INTO patient_portal_notifications (user_id, type, title, body) VALUES ($1, $2, $3, $4)`;

  let savepoint = false;
  try {
    await client.query("SAVEPOINT patient_notice");
    savepoint = true;
  } catch (error) {
    if (!/transaction/i.test(error.message || "")) throw error;
  }

  try {
    await client.query(fullSql, params);
    if (savepoint) await client.query("RELEASE SAVEPOINT patient_notice");
    return 1;
  } catch (error) {
    if (savepoint) await client.query("ROLLBACK TO SAVEPOINT patient_notice");
    if (error.code === "42703") {
      try {
        await client.query(shortSql, [id, type, title, body]);
        if (savepoint) await client.query("RELEASE SAVEPOINT patient_notice");
        return 1;
      } catch (fallbackError) {
        if (savepoint) {
          await client.query("ROLLBACK TO SAVEPOINT patient_notice");
          await client.query("RELEASE SAVEPOINT patient_notice");
        }
        if (fallbackError.code === "42P01") return 0;
        throw fallbackError;
      }
    }
    if (savepoint) await client.query("RELEASE SAVEPOINT patient_notice");
    if (error.code === "42P01") return 0;
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
