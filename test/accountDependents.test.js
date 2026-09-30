"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const { createPatientPortalRouter } = require("../routes/patientPortal");
const { createAdminPortalRouter } = require("../routes/adminPortal");
const accountDependents = require("../services/accountDependents");

test("dependent submission requires identity fields and a relationship", () => {
  assert.throws(() => accountDependents.parseSubmission({}), /First name and last name/);
  assert.throws(
    () =>
      accountDependents.parseSubmission({
        firstName: "Maria",
        lastName: "Santos",
        birthdate: "2018-04-01",
        sex: "Female",
      }),
    /relationship/
  );
  const payload = accountDependents.parseSubmission({
    firstName: "Maria",
    lastName: "Santos",
    birthdate: "2018-04-01",
    sex: "Female",
    relationship: "daughter",
    patientCategory: "pediatric",
  });
  assert.equal(payload.relationship, "child");
  assert.equal(payload.patientCategory, "pediatric");
  assert.equal(payload.eligibilityCategory, "child_under_12");
});

test("rejectDependent requires explicit confirmation", async () => {
  await assert.rejects(
    () =>
      accountDependents.rejectDependent(
        {
          async query() {
            return {
              rows: [
                {
                  id: 3,
                  guardian_user_id: "12",
                  first_name: "Maria",
                  last_name: "Santos",
                  approval_status: "pending",
                  relationship: "child",
                },
              ],
            };
          },
        },
        3,
        { id: "admin-1" },
        { confirmed: false }
      ),
    (error) => error.status === 400
  );
});

async function listen(app) {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

test("patients submit dependents as pending without creating a login user", async () => {
  const inserts = [];
  const notifications = [];
  const app = express();
  app.use(express.json());
  app.use(
    "/api/patient",
    createPatientPortalRouter({
      db: {
        async query(sql, params = []) {
          if (sql.includes("LOWER(link.approval_status) IN ('pending', 'approved')")) {
            return { rows: [] };
          }
          if (sql.startsWith("INSERT INTO patient_portal_dependents")) {
            inserts.push(params);
            return {
              rows: [
                {
                  id: 21,
                  guardian_user_id: "12",
                  relationship: params[1],
                  eligibility_category: params[2],
                  first_name: params[3],
                  middle_name: params[4],
                  last_name: params[5],
                  date_of_birth: params[6],
                  gender: params[7],
                  phone: params[8],
                  patient_category: params[9],
                  approval_status: "pending",
                  submitted_at: "2026-09-30T00:00:00.000Z",
                  created_at: "2026-09-30T00:00:00.000Z",
                },
              ],
            };
          }
          return { rows: [] };
        },
      },
      authenticateToken(req, _res, next) {
        req.user = { id: "12", role: "patient" };
        req.authUser = { id: "12", role: "patient" };
        next();
      },
      notifyAdmin: async (notification) => {
        notifications.push(notification);
        return 1;
      },
      uploadDirectory: "/tmp/dentasync-dependent-test",
    })
  );

  const server = await listen(app);
  try {
    const response = await fetch(`${server.url}/api/patient/dependents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        firstName: "Maria",
        lastName: "Santos",
        birthdate: "2018-04-01",
        sex: "Female",
        relationship: "child",
        patientCategory: "pediatric",
      }),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.dependent.approvalStatus, "pending");
    assert.equal(body.dependent.dependentUserId, "");
    assert.match(body.message, /awaiting Admin approval/i);
    assert.equal(inserts.length, 1);
    assert.equal(inserts[0][0], "12");
    assert.equal(notifications[0].type, "dependent");
    assert.equal(notifications[0].entityId, "21");
  } finally {
    await server.close();
  }
});

test("duplicate dependents under the same account are rejected", async () => {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/patient",
    createPatientPortalRouter({
      db: {
        async query(sql) {
          if (sql.includes("LOWER(link.approval_status) IN ('pending', 'approved')")) {
            return { rows: [{ id: 8 }] };
          }
          return { rows: [] };
        },
      },
      authenticateToken(req, _res, next) {
        req.user = { id: "12", role: "patient" };
        req.authUser = { id: "12", role: "patient" };
        next();
      },
      uploadDirectory: "/tmp/dentasync-dependent-test",
    })
  );
  const server = await listen(app);
  try {
    const response = await fetch(`${server.url}/api/patient/dependents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        firstName: "Maria",
        lastName: "Santos",
        birthdate: "2018-04-01",
        sex: "Female",
        relationship: "child",
      }),
    });
    assert.equal(response.status, 409);
  } finally {
    await server.close();
  }
});

test("pending dependents cannot be selected for appointment booking", async () => {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/patient",
    createPatientPortalRouter({
      db: {
        async query(sql) {
          if (sql.includes("FROM patient_portal_dependents") && sql.includes("approval_status")) {
            return { rows: [] };
          }
          return { rows: [] };
        },
      },
      authenticateToken(req, _res, next) {
        req.user = { id: "12", role: "patient" };
        req.authUser = { id: "12", role: "patient" };
        next();
      },
      uploadDirectory: "/tmp/dentasync-dependent-test",
    })
  );
  const server = await listen(app);
  try {
    const response = await fetch(`${server.url}/api/patient/appointments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        serviceId: "cleaning",
        appointmentDate: "2099-01-15",
        appointmentTime: "09:00",
        coverageType: "self_pay",
        forPatientUserId: "99",
      }),
    });
    assert.equal(response.status, 403);
    assert.match((await response.json()).message, /approved dependents/i);
  } finally {
    await server.close();
  }
});

test("staff cannot approve dependents through the admin API", async () => {
  const app = express();
  app.use(
    "/api/admin",
    createAdminPortalRouter({
      db: {
        async query(sql) {
          if (sql.includes("LOWER(role) = 'admin'")) {
            return { rows: [] };
          }
          return { rows: [] };
        },
      },
      authenticateToken(req, _res, next) {
        req.user = { id: "staff-1", role: "staff" };
        next();
      },
      emailDeliveryIsConfigured: () => false,
    })
  );
  const server = await listen(app);
  try {
    const pending = await fetch(`${server.url}/api/admin/dependents/pending`);
    assert.equal(pending.status, 403);
    const approve = await fetch(`${server.url}/api/admin/dependents/3/approve`, { method: "POST" });
    assert.equal(approve.status, 403);
  } finally {
    await server.close();
  }
});

test("dependents list stays available when new columns are missing", async () => {
  const app = express();
  app.use(
    "/api/patient",
    createPatientPortalRouter({
      db: {
        async query(sql) {
          if (sql.includes("ALTER TABLE") || sql.startsWith("UPDATE patient_portal_dependents")) {
            return { rows: [] };
          }
          if (sql.includes("link.first_name") || sql.includes("dependent.patient_id")) {
            const error = new Error('column "first_name" does not exist');
            error.code = "42703";
            throw error;
          }
          if (sql.includes("FROM patient_portal_dependents")) {
            return {
              rows: [
                {
                  id: 1,
                  guardian_user_id: "12",
                  dependent_user_id: "46",
                  relationship: "child",
                  created_at: "2026-09-01T00:00:00.000Z",
                  user_first_name: "Ana",
                  user_last_name: "Child",
                  user_email: "ana@example.test",
                },
              ],
            };
          }
          return { rows: [] };
        },
      },
      authenticateToken(req, _res, next) {
        req.user = { id: "12", role: "patient" };
        req.authUser = { id: "12", role: "patient" };
        next();
      },
      uploadDirectory: "/tmp/dentasync-dependent-test",
    })
  );
  const server = await listen(app);
  try {
    const response = await fetch(`${server.url}/api/patient/dependents`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.dependents.length, 1);
    assert.equal(body.dependents[0].fullName, "Ana Child");
    assert.equal(body.dependents[0].approvalStatus, "approved");
  } finally {
    await server.close();
  }
});
