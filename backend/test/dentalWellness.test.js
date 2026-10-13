"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const dentalWellness = require("../services/dentalWellness");
const { createDentistPortalRouter } = require("../routes/dentistPortal");
const { createPatientPortalRouter } = require("../routes/patientPortal");

const record = {
  id: 7,
  linkedUserId: "patient-1",
  archived: false,
};

function cleaningRow(overrides = {}) {
  return {
    treatment: "Cleaning / Oral Prophylaxis",
    status: "completed",
    treatmentDate: "2026-10-10",
    ...overrides,
  };
}

test("last cleaning uses the newest completed Oral Prophylaxis treatment date", () => {
  const date = dentalWellness.lastCleaningFromTreatments([
    cleaningRow({ treatmentDate: "2026-08-01", treatment: "Filling" }),
    cleaningRow({ treatmentDate: "2026-09-01", status: "planned" }),
    cleaningRow({ treatmentDate: "2026-10-10" }),
    cleaningRow({ treatmentDate: "2026-07-04", treatment: "Oral Prophylaxis" }),
  ]);
  assert.equal(date, "2026-10-10");
});

test("last cleaning is null when no completed prophylaxis exists", () => {
  assert.equal(
    dentalWellness.lastCleaningFromTreatments([
      cleaningRow({ status: "in_progress" }),
      { treatment: "Extraction", status: "completed", treatmentDate: "2026-10-10" },
    ]),
    null
  );
});

test("wellness score must be a whole number from 0 to 100", () => {
  assert.equal(dentalWellness.parseWellnessScore(0), 0);
  assert.equal(dentalWellness.parseWellnessScore("82"), 82);
  assert.throws(() => dentalWellness.parseWellnessScore(101), /0 to 100/);
  assert.throws(() => dentalWellness.parseWellnessScore(82.5), /whole number/);
  assert.throws(() => dentalWellness.parseWellnessScore(""), /0 to 100/);
});

test("saving an assessment stores the dentist score and does not copy last cleaning", async () => {
  const calls = [];
  const db = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("INSERT INTO dental_wellness_assessments")) {
        return {
          rows: [
            {
              id: 3,
              clinical_record_id: 7,
              patient_user_id: "patient-1",
              assessment_date: params[2],
              wellness_score: params[3],
              clinical_notes: params[4],
              next_checkup: params[5],
              dentist_id: params[6],
              created_at: "2026-10-13T00:00:00.000Z",
              updated_at: "2026-10-13T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO patient_portal_profiles")) {
        return { rows: [] };
      }
      if (sql.includes("FROM clinic_patient_treatments")) {
        return {
          rows: [
            {
              id: 11,
              treatment: "Cleaning / Oral Prophylaxis",
              status: "completed",
              treatment_date: "2026-10-10",
            },
          ],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const saved = await dentalWellness.saveAssessment(
    db,
    record,
    {
      oralHealthScore: 82,
      assessmentDate: "2026-10-13",
      clinicalNotes: "Gingiva healthy.",
      nextCheckup: "2026-11-10",
    },
    { id: "dentist-1" }
  );

  assert.equal(saved.hasAssessment, true);
  assert.equal(saved.oralHealthScore, 82);
  assert.equal(saved.assessmentDate, "2026-10-13");
  assert.equal(saved.nextCheckup, "2026-11-10");
  assert.equal(saved.lastCleaning, "2026-10-10");
  assert.equal(saved.dentistId, "dentist-1");

  const profileSync = calls.find((call) => call.sql.includes("INSERT INTO patient_portal_profiles"));
  assert.ok(profileSync);
  assert.deepEqual(profileSync.params, ["patient-1", 82, "2026-11-10"]);
  assert.equal(profileSync.sql.includes("last_cleaning"), false);
});

test("portal wellness is scoped to the authenticated patient's linked record", async () => {
  const db = {
    async query(sql, params = []) {
      if (sql.includes("FROM clinic_patient_records") && sql.includes("linked_user_id")) {
        if (String(params[0]) !== "patient-1") {
          return { rows: [] };
        }
        return { rows: [{ id: 7, linked_user_id: "patient-1" }] };
      }
      if (sql.includes("FROM clinic_patient_treatments")) {
        return {
          rows: [
            {
              treatment: "Oral Prophylaxis",
              status: "completed",
              treatment_date: "2026-10-10",
            },
          ],
        };
      }
      if (sql.includes("FROM dental_wellness_assessments")) {
        return {
          rows: [
            {
              id: 3,
              wellness_score: 82,
              assessment_date: "2026-10-13",
              clinical_notes: "Gingiva healthy.",
              next_checkup: "2026-11-10",
              dentist_id: "dentist-1",
              updated_at: "2026-10-13T00:00:00.000Z",
            },
          ],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const own = await dentalWellness.getPortalWellness(db, "patient-1");
  assert.equal(own.oralHealthScore, 82);
  assert.equal(own.lastCleaning, "2026-10-10");
  assert.equal(own.nextCheckup, "2026-11-10");

  const other = await dentalWellness.getPortalWellness(db, "patient-2");
  assert.equal(other.hasAssessment, false);
  assert.equal(other.oralHealthScore, null);
  assert.equal(other.lastCleaning, null);
});

test("patients without an assessment keep a pending score", async () => {
  const snapshot = await dentalWellness.getWellnessForClinicalRecord(
    {
      async query(sql) {
        if (sql.includes("FROM dental_wellness_assessments")) {
          return { rows: [] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    },
    { id: 9 },
    []
  );
  assert.equal(snapshot.hasAssessment, false);
  assert.equal(snapshot.oralHealthScore, null);
  assert.equal(snapshot.nextCheckup, null);
});

async function startDentistPortal({ databaseRole = "dentist" } = {}) {
  const assessments = new Map();
  const app = express();
  app.use(express.json());

  async function query(sql, params = []) {
    if (sql.includes("FROM users AS account") && sql.includes("LOWER(account.role) = 'dentist'")) {
      if (databaseRole !== "dentist") return { rows: [] };
      return {
        rows: [
          {
            id: "dentist-1",
            first_name: "Sarah",
            last_name: "Cruz",
            email: "dentist@example.test",
            phone: "639173333333",
            role: "dentist",
            status: "Active",
            is_verified: true,
            created_at: "2026-01-01T00:00:00.000Z",
            specialization: "Orthodontics",
            schedule_notes: "Mon–Fri",
            catalog_dentist_id: "dr-sarah-cruz",
          },
        ],
      };
    }
    if (sql.includes("FROM clinic_patient_records AS record") && sql.includes("WHERE record.id = $1")) {
      return {
        rows: [
          {
            id: 7,
            record_code: "CR-7",
            first_name: "Juan",
            last_name: "Dela Cruz",
            email: "juan@example.com",
            phone: "09171111111",
            linked_user_id: "patient-1",
            is_archived: false,
            date_of_birth: "2005-01-10",
            gender: "Male",
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-10-13T00:00:00.000Z",
          },
        ],
      };
    }
    if (sql.includes("FROM clinic_patient_treatments") && sql.includes("clinical_record_id = $1") && sql.includes("LIMIT 250")) {
      return {
        rows: [
          {
            id: 11,
            clinical_record_id: 7,
            treatment: "Cleaning / Oral Prophylaxis",
            status: "completed",
            treatment_date: "2026-10-10",
            dentist_name: "Dr Sarah Cruz",
            amount_charged: 1000,
            amount_paid: 1000,
          },
        ],
      };
    }
    if (sql.includes("FROM users AS account") && sql.includes("patient_portal_profiles")) {
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO dental_wellness_assessments")) {
      const row = {
        id: 3,
        clinical_record_id: params[0],
        patient_user_id: params[1],
        assessment_date: params[2],
        wellness_score: params[3],
        clinical_notes: params[4],
        next_checkup: params[5],
        dentist_id: params[6],
        created_at: "2026-10-13T00:00:00.000Z",
        updated_at: "2026-10-13T00:00:00.000Z",
      };
      assessments.set(String(params[0]), row);
      return { rows: [row] };
    }
    if (sql.includes("INSERT INTO patient_portal_profiles")) {
      return { rows: [] };
    }
    if (sql.includes("FROM dental_wellness_assessments")) {
      const row = assessments.get(String(params[0]));
      return { rows: row ? [row] : [] };
    }
    if (sql.includes("patient_portal_queue_entries")) {
      return { rows: [] };
    }
    if (sql.includes("COUNT(*) AS count")) {
      return { rows: [{ count: "0" }] };
    }
    throw new Error(`Unexpected query: ${sql} :: ${JSON.stringify(params)}`);
  }

  app.use(
    "/api/dentist",
    createDentistPortalRouter({
      db: { query },
      authenticateToken(req, _res, next) {
        req.user = { id: "dentist-1", role: "dentist" };
        next();
      },
    })
  );

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/api/dentist`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

test("dentist can save a wellness assessment for the canonical patient record", async () => {
  const portal = await startDentistPortal();
  try {
    const response = await fetch(`${portal.url}/patients/7/wellness-assessment`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        oralHealthScore: 82,
        assessmentDate: "2026-10-13",
        clinicalNotes: "Stable oral hygiene.",
        nextCheckup: "2026-11-10",
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.wellness.oralHealthScore, 82);
    assert.equal(body.wellness.lastCleaning, "2026-10-10");
    assert.equal(body.wellness.nextCheckup, "2026-11-10");
    assert.equal(body.wellness.hasAssessment, true);
  } finally {
    await portal.close();
  }
});

test("staff cannot save a dental wellness assessment", async () => {
  const portal = await startDentistPortal({ databaseRole: "staff" });
  try {
    const response = await fetch(`${portal.url}/patients/7/wellness-assessment`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        oralHealthScore: 82,
        assessmentDate: "2026-10-13",
        nextCheckup: "2026-11-10",
      }),
    });
    assert.equal(response.status, 403);
  } finally {
    await portal.close();
  }
});

test("patient dashboard stays pending until a dentist assessment exists", async () => {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/patient",
    createPatientPortalRouter({
      db: {
        async query(sql, params = []) {
          if (sql.includes("FROM users") && sql.includes("WHERE id = $1") && !sql.includes("AS account")) {
            return {
              rows: [
                {
                  id: "patient-1",
                  first_name: "Juan",
                  last_name: "Dela Cruz",
                  email: "juan@example.com",
                  phone: "09171111111",
                  is_verified: true,
                },
              ],
            };
          }
          if (sql.includes("COUNT(*) FILTER") && sql.includes("FROM patient_portal_appointments")) {
            return { rows: [{ active_appointments: "0", completed_visits: "0" }] };
          }
          if (sql.includes("FROM patient_portal_appointments")) {
            return { rows: [] };
          }
          if (sql.includes("FROM patient_portal_queue_entries")) {
            return { rows: [] };
          }
          if (sql.includes("FROM patient_portal_profiles")) {
            return {
              rows: [
                {
                  oral_health_score: null,
                  last_cleaning: null,
                  next_checkup: null,
                  hmo_status: "not_enrolled",
                  membership_tier: "Premium Patient",
                },
              ],
            };
          }
          if (sql.includes("FROM patient_portal_notifications") || sql.includes("FROM patient_portal_notification_preferences")) {
            return { rows: [] };
          }
          if (sql.includes("FROM clinic_patient_records") && sql.includes("linked_user_id")) {
            return String(params[0]) === "patient-1" ? { rows: [{ id: 7, linked_user_id: "patient-1" }] } : { rows: [] };
          }
          if (sql.includes("FROM clinic_patient_treatments")) {
            return { rows: [] };
          }
          if (sql.includes("FROM dental_wellness_assessments")) {
            return { rows: [] };
          }
          throw new Error(`Unexpected query: ${sql}`);
        },
      },
      authenticateToken(req, _res, next) {
        req.user = { id: "patient-1", role: "patient" };
        next();
      },
    })
  );

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const url = `http://127.0.0.1:${server.address().port}/api/patient`;
  try {
    const response = await fetch(`${url}/dashboard`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.wellness.oralHealthScore, null);
    assert.equal(body.wellness.lastCleaning, null);
    assert.equal(body.wellness.nextCheckup, null);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
