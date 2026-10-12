"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const queueNumbers = require("../services/queueNumbers");

function createCounterDb() {
  const counters = new Map();
  const tokens = [];
  return {
    counters,
    tokens,
    async query(sql, params = []) {
      if (sql.includes("CURRENT_TIMESTAMP AT TIME ZONE")) {
        return { rows: [{ clinic_date: params[0] === "Asia/Manila" || true ? "2026-10-12" : "2026-10-12" }] };
      }
      if (sql.includes("INSERT INTO clinic_daily_queue_counters")) {
        const key = `${params[0]}:${params[1]}`;
        const next = (counters.get(key) || 0) + 1;
        counters.set(key, next);
        return { rows: [{ last_sequence: next }] };
      }
      if (sql.includes("FROM patient_portal_queue_entries")) {
        return { rows: tokens.filter((token) => String(token).startsWith(`${params[0].slice(0, 1)}-`)).map((token) => ({ token })) };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

test("queue numbers use category prefix and a three-digit daily sequence", () => {
  assert.equal(queueNumbers.formatQueueNumber("A", 1), "A-001");
  assert.equal(queueNumbers.formatQueueNumber("S", 2), "S-002");
  assert.equal(queueNumbers.formatQueueNumber("P", 3), "P-003");
  assert.equal(queueNumbers.formatQueueNumber("W", 12), "W-012");
  assert.deepEqual(queueNumbers.parseQueueNumber("A-001"), { prefix: "A", sequence: 1 });
  assert.equal(queueNumbers.parseQueueNumber("A-260918-014-ABC"), null);
});

test("prefix comes from the canonical patient category, not a silent Regular default", () => {
  assert.equal(queueNumbers.prefixFromPatientRecord({ patientCategory: "regular" }), "A");
  assert.equal(queueNumbers.prefixFromPatientRecord({ patientCategory: "Senior Citizen" }), "S");
  assert.equal(queueNumbers.prefixFromPatientRecord({ patientCategory: "pediatric" }), "P");
  assert.equal(queueNumbers.prefixFromPatientRecord({ patientCategory: "pwd" }), "W");
  assert.equal(
    queueNumbers.prefixFromPatientRecord({ patientCategory: "mystery", clinicPatientId: "S202610_04" }),
    "S"
  );
  assert.equal(queueNumbers.prefixFromPatientRecord({ clinicPatientId: "A202610_01" }), "A");
  assert.equal(queueNumbers.prefixFromPatientRecord({ patientCategory: "unknown" }), null);
});

test("daily counters are independent per category and persist across calls", async () => {
  const db = createCounterDb();
  const firstRegular = await queueNumbers.allocateDailyQueueNumber(db, { patientCategory: "regular" });
  const secondRegular = await queueNumbers.allocateDailyQueueNumber(db, { patientCategory: "regular" });
  const firstSenior = await queueNumbers.allocateDailyQueueNumber(db, { patientCategory: "senior" });
  const firstPediatric = await queueNumbers.allocateDailyQueueNumber(db, { patientCategory: "pediatric" });
  const firstPwd = await queueNumbers.allocateDailyQueueNumber(db, { patientCategory: "pwd" });
  const thirdRegular = await queueNumbers.allocateDailyQueueNumber(db, { patientCategory: "regular" });

  assert.equal(firstRegular, "A-001");
  assert.equal(secondRegular, "A-002");
  assert.equal(firstSenior, "S-001");
  assert.equal(firstPediatric, "P-001");
  assert.equal(firstPwd, "W-001");
  assert.equal(thirdRegular, "A-003");
  assert.equal(db.counters.get("2026-10-12:A"), 3);
});

test("a new clinic date restarts each category at 001", async () => {
  const db = createCounterDb();
  await queueNumbers.allocateDailyQueueNumber(db, { patientCategory: "regular" });
  await queueNumbers.allocateDailyQueueNumber(db, { patientCategory: "regular" });
  db.query = async (sql, params = []) => {
    if (sql.includes("CURRENT_TIMESTAMP AT TIME ZONE")) {
      return { rows: [{ clinic_date: "2026-10-13" }] };
    }
    if (sql.includes("INSERT INTO clinic_daily_queue_counters")) {
      const key = `${params[0]}:${params[1]}`;
      const next = (db.counters.get(key) || 0) + 1;
      db.counters.set(key, next);
      return { rows: [{ last_sequence: next }] };
    }
    throw new Error(sql);
  };
  const nextDay = await queueNumbers.allocateDailyQueueNumber(db, { patientCategory: "regular" });
  assert.equal(nextDay, "A-001");
  assert.equal(db.counters.get("2026-10-13:A"), 1);
  assert.equal(db.counters.get("2026-10-12:A"), 2);
});

test("missing category is rejected instead of minting the wrong prefix", async () => {
  await assert.rejects(
    () => queueNumbers.allocateDailyQueueNumber({ query: async () => ({ rows: [] }) }, {}),
    (error) => error.status === 400 && /category/i.test(error.message)
  );
});

test("permanent patient IDs stay in PREFIXYYYYMM_NN form", () => {
  const patientIds = require("../services/patientIds");
  assert.equal(patientIds.formatPatientId("A", 2026, 10, 1), "A202610_01");
  assert.notEqual(patientIds.formatPatientId("A", 2026, 10, 1), queueNumbers.formatQueueNumber("A", 1));
});
