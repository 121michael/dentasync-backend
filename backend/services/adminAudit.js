"use strict";

async function writeAdminAudit(db, entry = {}) {
  if (!db || typeof db.query !== "function") {
    return null;
  }

  const action = typeof entry.action === "string" ? entry.action.trim().slice(0, 120) : "";
  if (!action) {
    return null;
  }

  const result = ["success", "warning", "failed", "blocked"].includes(entry.result)
    ? entry.result
    : "success";

  try {
    const response = await db.query(
      `INSERT INTO admin_portal_audit_logs (
         actor_id, actor_name, actor_role, action, target_type, target_id,
         target_label, result, detail, ip_address, session_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, created_at`,
      [
        entry.actorId ? String(entry.actorId).slice(0, 120) : null,
        entry.actorName ? String(entry.actorName).slice(0, 160) : null,
        entry.actorRole ? String(entry.actorRole).slice(0, 40) : null,
        action,
        entry.targetType ? String(entry.targetType).slice(0, 80) : null,
        entry.targetId ? String(entry.targetId).slice(0, 120) : null,
        entry.targetLabel ? String(entry.targetLabel).slice(0, 200) : null,
        result,
        entry.detail ? String(entry.detail).slice(0, 2000) : null,
        entry.ipAddress ? String(entry.ipAddress).slice(0, 80) : null,
        entry.sessionId ? String(entry.sessionId).slice(0, 120) : null,
      ]
    );
    return response.rows[0] || null;
  } catch (error) {
    if (error?.code === "42P01") {
      return null;
    }
    console.error("Admin audit write failed:", error.message);
    return null;
  }
}

module.exports = {
  writeAdminAudit,
};
