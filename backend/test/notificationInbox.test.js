"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const db = require("../db");
const { notifyActiveStaff } = require("../services/staffNotifications");
const { createStaffPortalRouter, appointmentNoticeChanged } = require("../routes/staffPortal");
const { createPatientPortalRouter } = require("../routes/patientPortal");
const { createDentistPortalRouter } = require("../routes/dentistPortal");
const { createAdminPortalRouter } = require("../routes/adminPortal");

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done, reject) => server.close((error) => (error ? reject(error) : done()))),
      });
    });
  });
}

function appFor(role, userId) {
  const app = express();
  app.use(express.json());
  const authenticateToken = (req, _res, next) => {
    req.user = { id: String(userId), role };
    next();
  };
  if (role === "staff") {
    app.use("/api/staff", createStaffPortalRouter({ db, authenticateToken, passwordResetService: { requestReset: async () => ({}) } }));
  } else if (role === "patient") {
    app.use("/api/patient", createPatientPortalRouter({ db, authenticateToken, jwtSecret: "notification-inbox-test" }));
  } else if (role === "dentist") {
    app.use("/api/dentist", createDentistPortalRouter({ db, authenticateToken }));
  } else {
    app.use("/api/admin", createAdminPortalRouter({ db, authenticateToken, passwordResetService: { requestReset: async () => ({}) } }));
  }
  return app;
}

async function createUser(role, label) {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const row = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, status, is_verified)
     VALUES ($1, 'Notice', $2, $3, 'x', $4, 'Active', TRUE)
     RETURNING id`,
    [label, `${label}.${suffix}@amethyst.test`, `639${String(suffix).slice(-9)}`, role]
  );
  return String(row.rows[0].id);
}

test("appointment notifications are skipped when the saved status did not change", () => {
  const pending = { status: "pending", appointment_date: "2026-11-10", appointment_time: "09:30:00" };
  const confirmed = { status: "confirmed", appointment_date: "2026-11-10", appointment_time: "09:30:00" };
  assert.equal(appointmentNoticeChanged(pending, confirmed), true);
  assert.equal(appointmentNoticeChanged(confirmed, confirmed), false);
  assert.equal(
    appointmentNoticeChanged(confirmed, { ...confirmed, appointment_time: "10:15:00" }),
    true
  );
});

test("staff prescription notices are not duplicated for the same send", async () => {
  const staffId = await createUser("staff", "NoticeStaff");
  const entityId = `rx-notice-${staffId}`;
  const payload = {
    type: "prescription",
    title: "Prescription sent to staff",
    body: `Synthetic prescription ${entityId} was sent to staff for processing.`,
    entityType: "prescription",
    entityId,
    dedupe: true,
  };
  try {
    const first = await notifyActiveStaff(db, payload);
    const second = await notifyActiveStaff(db, payload);
    assert.ok(first >= 1);
    assert.equal(second, 0);
    const mine = await db.query(
      `SELECT COUNT(*)::int AS count
       FROM staff_portal_notifications
       WHERE user_id = $1 AND entity_id = $2`,
      [staffId, entityId]
    );
    assert.equal(mine.rows[0].count, 1);
  } finally {
    await db.query(`DELETE FROM staff_portal_notifications WHERE entity_id = $1`, [entityId]);
  }
});

test("a user cannot read or update another user's notifications", async () => {
  const staffA = await createUser("staff", "InboxA");
  const staffB = await createUser("staff", "InboxB");
  const patientA = await createUser("patient", "InboxPatientA");
  const patientB = await createUser("patient", "InboxPatientB");
  const dentistA = await createUser("dentist", "InboxDentistA");
  const dentistB = await createUser("dentist", "InboxDentistB");
  const adminA = await createUser("admin", "InboxAdminA");
  const adminB = await createUser("admin", "InboxAdminB");
  const marker = `synthetic-inbox-${staffA}`;
  const inserted = {};
  try {
    inserted.staff = (await db.query(
      `INSERT INTO staff_portal_notifications (user_id, type, title, body, entity_type, entity_id)
       VALUES ($1, 'appointment', 'New Appointment Request', $2, 'appointment', '4242')
       RETURNING id`,
      [staffA, marker]
    )).rows[0].id;
    inserted.patient = (await db.query(
      `INSERT INTO patient_portal_notifications (user_id, type, title, body, entity_type, entity_id)
       VALUES ($1, 'appointment', 'Appointment request received', $2, 'appointment', '4242')
       RETURNING id`,
      [patientA, marker]
    )).rows[0].id;
    inserted.dentist = (await db.query(
      `INSERT INTO dentist_portal_notifications (user_id, type, title, body, entity_type, entity_id)
       VALUES ($1, 'appointment', 'New Appointment Request', $2, 'appointment', '4242')
       RETURNING id`,
      [dentistA, marker]
    )).rows[0].id;
    inserted.admin = (await db.query(
      `INSERT INTO admin_portal_notifications (user_id, type, title, body, entity_type, entity_id)
       VALUES ($1, 'appointment', 'New Appointment Request', $2, 'appointment', '4242')
       RETURNING id`,
      [adminA, marker]
    )).rows[0].id;

    const cases = [
      ["staff", staffA, staffB, "/api/staff/notifications", inserted.staff],
      ["patient", patientA, patientB, "/api/patient/notifications", inserted.patient],
      ["dentist", dentistA, dentistB, "/api/dentist/notifications", inserted.dentist],
      ["admin", adminA, adminB, "/api/admin/notifications", inserted.admin],
    ];

    for (const [role, ownerId, otherId, path, notificationId] of cases) {
      const owner = await listen(appFor(role, ownerId));
      const other = await listen(appFor(role, otherId));
      try {
        const hidden = await fetch(`${other.url}${path}`);
        const hiddenBody = await hidden.json();
        assert.equal(hidden.status, 200, hiddenBody.message);
        assert.equal(hiddenBody.notifications.some((item) => String(item.id) === String(notificationId)), false);
        const denied = await fetch(`${other.url}${path}/${notificationId}/read`, { method: "PATCH" });
        assert.equal(denied.status, 404);

        const first = await fetch(`${owner.url}${path}`);
        const firstBody = await first.json();
        assert.equal(first.status, 200, firstBody.message);
        const row = firstBody.notifications.find((item) => String(item.id) === String(notificationId));
        assert.ok(row);
        assert.equal(row.read, false);
        assert.equal(firstBody.unreadCount, firstBody.notifications.filter((item) => !item.read).length);

        const unchanged = await fetch(`${owner.url}${path}`);
        const unchangedBody = await unchanged.json();
        assert.equal(unchangedBody.notifications.find((item) => String(item.id) === String(notificationId)).read, false);

        const marked = await fetch(`${owner.url}${path}/${notificationId}/read`, { method: "PATCH" });
        assert.equal(marked.status, 200);
        const after = await fetch(`${owner.url}${path}`);
        const afterBody = await after.json();
        assert.equal(afterBody.notifications.find((item) => String(item.id) === String(notificationId)).read, true);
        assert.equal(afterBody.unreadCount, 0);

        await db.query(
          `INSERT INTO ${role === "staff" ? "staff_portal_notifications" : role === "patient" ? "patient_portal_notifications" : role === "dentist" ? "dentist_portal_notifications" : "admin_portal_notifications"}
             (user_id, type, title, body)
           VALUES ($1, 'system', 'Synthetic follow-up', $2)`,
          [ownerId, `${marker}-follow`]
        );
        const all = await fetch(`${owner.url}${path}/read-all`, { method: "PATCH" });
        const allBody = await all.json();
        assert.equal(all.status, 200, allBody.message);
        assert.ok(allBody.markedRead >= 1);
        const persisted = await fetch(`${owner.url}${path}`);
        const persistedBody = await persisted.json();
        assert.equal(persistedBody.unreadCount, 0);
        assert.equal(persistedBody.notifications.every((item) => item.read), true);
      } finally {
        await owner.close();
        await other.close();
      }
    }
  } finally {
    await db.query(`DELETE FROM staff_portal_notifications WHERE body LIKE $1`, [`%${marker}%`]);
    await db.query(`DELETE FROM patient_portal_notifications WHERE body LIKE $1`, [`%${marker}%`]);
    await db.query(`DELETE FROM dentist_portal_notifications WHERE body LIKE $1`, [`%${marker}%`]);
    await db.query(`DELETE FROM admin_portal_notifications WHERE body LIKE $1`, [`%${marker}%`]);
  }
});
