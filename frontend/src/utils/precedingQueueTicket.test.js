import assert from "node:assert/strict";
import test from "node:test";
import { dashboardPrecedingTicket } from "./precedingQueueTicket.js";

const lane = [
  { token: "A-001", status: "dentist", position: 1, dentistId: "d1", isCurrentPatient: false },
  { token: "A-002", status: "waiting", position: 2, dentistId: "d1", isCurrentPatient: false },
  { token: "A-201", status: "waiting", position: 3, dentistId: "d2", isCurrentPatient: false },
  { token: "A-003", status: "waiting", position: 4, dentistId: "d1", isCurrentPatient: false },
  { token: "A-004", status: "completed", position: 5, dentistId: "d1", isCurrentPatient: false },
];

test("first waiting patient sees the in-treatment ticket ahead, not tickets behind", () => {
  const result = dashboardPrecedingTicket(lane, { token: "A-002", status: "waiting", dentistId: "d1" });
  assert.equal(result.kind, "ahead");
  assert.equal(result.ticket.token, "A-001");
  assert.equal(result.ticket.status, "dentist");
});

test("middle waiting patient sees only the ticket immediately ahead in the dentist lane", () => {
  const result = dashboardPrecedingTicket(lane, { token: "A-003", status: "waiting", dentistId: "d1" });
  assert.equal(result.kind, "ahead");
  assert.equal(result.ticket.token, "A-002");
  assert.doesNotMatch(JSON.stringify(result), /A-201/);
  assert.doesNotMatch(JSON.stringify(result), /A-001/);
});

test("first in an empty chair is next in line", () => {
  const result = dashboardPrecedingTicket(
    [
      { token: "A-010", status: "waiting", position: 1, dentistId: "d1", isCurrentPatient: true },
      { token: "A-011", status: "waiting", position: 2, dentistId: "d1" },
    ],
    { token: "A-010", status: "waiting", dentistId: "d1", isCurrentPatient: true }
  );
  assert.equal(result.kind, "next");
});

test("last waiting patient still uses queue order instead of ticket-number math", () => {
  const result = dashboardPrecedingTicket(
    [
      { token: "A-010", status: "dentist", position: 1, dentistId: "d1" },
      { token: "A-002", status: "waiting", position: 2, dentistId: "d1", isCurrentPatient: true },
    ],
    { token: "A-002", status: "waiting", dentistId: "d1", isCurrentPatient: true }
  );
  assert.equal(result.kind, "ahead");
  assert.equal(result.ticket.token, "A-010");
});

test("signed-in patient already in treatment sees in-progress, not other tickets", () => {
  const result = dashboardPrecedingTicket(lane, {
    token: "A-001",
    status: "in_chair",
    dentistId: "d1",
    isCurrentPatient: true,
  });
  assert.equal(result.kind, "in_progress");
});

test("completed and cancelled tickets are not treated as ahead", () => {
  const result = dashboardPrecedingTicket(
    [
      { token: "A-001", status: "completed", position: 1, dentistId: "d1" },
      { token: "A-002", status: "cancelled", position: 2, dentistId: "d1" },
      { token: "A-003", status: "waiting", position: 3, dentistId: "d1", isCurrentPatient: true },
    ],
    { token: "A-003", status: "waiting", dentistId: "d1", isCurrentPatient: true }
  );
  assert.equal(result.kind, "next");
});
