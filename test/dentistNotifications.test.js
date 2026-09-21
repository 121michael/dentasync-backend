"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  dentistMatchesAssignment,
  notifyDentists,
} = require("../services/dentistNotifications");

test("dentist assignment matches catalog id, user id, or display name", () => {
  const dentist = {
    id: "dentist-1",
    first_name: "Sarah",
    last_name: "Cruz",
    catalog_dentist_id: "dr-sarah-cruz",
  };
  assert.equal(dentistMatchesAssignment(dentist, { dentistId: "dr-sarah-cruz" }), true);
  assert.equal(dentistMatchesAssignment(dentist, { dentistId: "dentist-1" }), true);
  assert.equal(dentistMatchesAssignment(dentist, { dentistName: "Dr. Sarah Cruz" }), true);
  assert.equal(dentistMatchesAssignment(dentist, { dentistId: "dr-other" }), false);
});

test("notifyDentists inserts for assigned dentist accounts", async () => {
  const inserts = [];
  const db = {
    async query(sql, params = []) {
      if (sql.includes("FROM users AS account") && sql.includes("LOWER(account.role) = 'dentist'")) {
        return {
          rows: [
            {
              id: "dentist-1",
              first_name: "Sarah",
              last_name: "Cruz",
              catalog_dentist_id: "dr-sarah-cruz",
            },
            {
              id: "dentist-2",
              first_name: "James",
              last_name: "Reyes",
              catalog_dentist_id: "dr-james-reyes",
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO dentist_portal_notifications")) {
        inserts.push(params);
        return { rowCount: Array.isArray(params[0]) ? params[0].length : 0 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const count = await notifyDentists(db, {
    type: "appointment",
    title: "New Appointment Request",
    body: "Cleaning tomorrow.",
    entityType: "appointment",
    entityId: "88",
    dentistId: "dr-sarah-cruz",
    dentistName: "Dr. Sarah Cruz",
  });

  assert.equal(count, 1);
  assert.equal(inserts.length, 1);
  assert.deepEqual(inserts[0][0], ["dentist-1"]);
  assert.equal(inserts[0][1], "appointment");
  assert.equal(inserts[0][5], "88");
});

test("notifyDentists falls back to every active dentist when assignment is unknown", async () => {
  const inserts = [];
  const db = {
    async query(sql, params = []) {
      if (sql.includes("FROM users AS account")) {
        return {
          rows: [
            { id: "dentist-1", first_name: "Sarah", last_name: "Cruz", catalog_dentist_id: "dr-sarah-cruz" },
            { id: "dentist-2", first_name: "James", last_name: "Reyes", catalog_dentist_id: "dr-james-reyes" },
          ],
        };
      }
      if (sql.includes("INSERT INTO dentist_portal_notifications")) {
        inserts.push(params);
        return { rowCount: params[0].length };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const count = await notifyDentists(db, {
    type: "check_in",
    title: "Patient checked in",
    body: "Queue #12",
    entityType: "queue",
    entityId: "12",
    dentistId: "walk-in-unknown",
  });

  assert.equal(count, 2);
  assert.deepEqual(inserts[0][0], ["dentist-1", "dentist-2"]);
});
