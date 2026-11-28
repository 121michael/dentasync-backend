import assert from "node:assert/strict";
import test from "node:test";
import { dashboardNextInLine } from "./precedingQueueTicket.js";

const lane = [
  { token: "A-001", status: "dentist", position: 1, dentistId: "d1", isCurrentPatient: false },
  { token: "A-002", status: "waiting", position: 2, dentistId: "d1", isCurrentPatient: false },
  { token: "A-201", status: "waiting", position: 3, dentistId: "d2", isCurrentPatient: false },
  { token: "A-003", status: "waiting", position: 4, dentistId: "d1", isCurrentPatient: false },
  { token: "A-004", status: "completed", position: 5, dentistId: "d1", isCurrentPatient: false },
];

test("first waiting patient is next in line, not the person in treatment", () => {
  const result = dashboardNextInLine(lane, { token: "A-002", status: "waiting", dentistId: "d1" });
  assert.equal(result.kind, "next");
  assert.equal(result.ticket, undefined);
});

test("later waiting patient sees the person next in line, not how many are ahead", () => {
  const result = dashboardNextInLine(lane, { token: "A-003", status: "waiting", dentistId: "d1" });
  assert.equal(result.kind, "next_person");
  assert.equal(result.ticket.token, "A-002");
  assert.equal(result.ticket.status, "waiting");
  assert.equal(result.peopleAhead, undefined);
  assert.doesNotMatch(JSON.stringify(result), /A-201/);
  assert.doesNotMatch(JSON.stringify(result), /A-001/);
  assert.doesNotMatch(JSON.stringify(result), /people ahead/i);
});

test("first in an empty chair is next in line", () => {
  const result = dashboardNextInLine(
    [
      { token: "A-010", status: "waiting", position: 1, dentistId: "d1", isCurrentPatient: true },
      { token: "A-011", status: "waiting", position: 2, dentistId: "d1" },
    ],
    { token: "A-010", status: "waiting", dentistId: "d1", isCurrentPatient: true }
  );
  assert.equal(result.kind, "next");
});

test("last waiting patient still uses queue order instead of ticket-number math", () => {
  const result = dashboardNextInLine(
    [
      { token: "A-010", status: "dentist", position: 1, dentistId: "d1" },
      { token: "A-002", status: "waiting", position: 2, dentistId: "d1", isCurrentPatient: true },
    ],
    { token: "A-002", status: "waiting", dentistId: "d1", isCurrentPatient: true }
  );
  assert.equal(result.kind, "next");
});

test("signed-in patient already in treatment sees in-progress, not other tickets", () => {
  const result = dashboardNextInLine(lane, {
    token: "A-001",
    status: "in_chair",
    dentistId: "d1",
    isCurrentPatient: true,
  });
  assert.equal(result.kind, "in_progress");
});

test("completed and cancelled tickets are not treated as next in line", () => {
  const result = dashboardNextInLine(
    [
      { token: "A-001", status: "completed", position: 1, dentistId: "d1" },
      { token: "A-002", status: "cancelled", position: 2, dentistId: "d1" },
      { token: "A-003", status: "waiting", position: 3, dentistId: "d1", isCurrentPatient: true },
    ],
    { token: "A-003", status: "waiting", dentistId: "d1", isCurrentPatient: true }
  );
  assert.equal(result.kind, "next");
});
