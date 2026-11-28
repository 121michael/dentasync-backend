"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  withSavepoint,
  schemaError,
  publicCheckInMessage,
  checkInFailureResponse,
} = require("../services/postgresTxn");

test("undefined visit_origin maps to setup-required for 066", () => {
  const error = Object.assign(new Error('column "visit_origin" does not exist'), { code: "42703" });
  const mapped = schemaError(error);
  assert.equal(mapped.status, 503);
  assert.equal(mapped.code, "SETUP_REQUIRED");
  assert.equal(mapped.migration, "066_appointment_visit_origin.sql");
  assert.match(mapped.adminMessage, /066_appointment_visit_origin\.sql/);
  assert.equal(
    publicCheckInMessage(error),
    "Check-in is temporarily unavailable. Contact an administrator to complete setup."
  );
  assert.doesNotMatch(publicCheckInMessage(error), /066_appointment_visit_origin/);
  assert.doesNotMatch(publicCheckInMessage(error), /aborted/);
});

test("missing QR redemption table maps to setup-required for 016", () => {
  const error = Object.assign(new Error('relation "staff_walkin_qr_redemptions" does not exist'), {
    code: "42P01",
  });
  const mapped = schemaError(error);
  assert.equal(mapped.migration, "016_staff_walkin_qr.sql");
  assert.equal(checkInFailureResponse(error).status, 503);
  assert.equal(
    checkInFailureResponse(error).message,
    "Check-in is temporarily unavailable. Contact an administrator to complete setup."
  );
});

test("withSavepoint rolls back optional SQL so the outer transaction can continue", async () => {
  const commands = [];
  let aborted = false;
  const client = {
    async query(sql) {
      const text = String(sql);
      commands.push(text);
      if (/^ROLLBACK TO SAVEPOINT/i.test(text.trim())) {
        aborted = false;
        return { rows: [] };
      }
      if (aborted) {
        const followOn = Object.assign(new Error("current transaction is aborted, commands ignored until end of transaction block"), {
          code: "25P02",
        });
        throw followOn;
      }
      if (/visit_origin/.test(text)) {
        aborted = true;
        throw Object.assign(new Error('column "visit_origin" does not exist'), { code: "42703" });
      }
      return { rows: [] };
    },
  };

  await assert.rejects(
    () => withSavepoint(client, "walkin_insert_origin", () => client.query(`INSERT INTO x (visit_origin) VALUES ('walk_in')`)),
    (error) => error.code === "42703"
  );
  await client.query("SELECT 1");
  assert.equal(aborted, false);
  assert.ok(commands.some((item) => /^SAVEPOINT /i.test(item.trim())));
  assert.ok(commands.some((item) => /^ROLLBACK TO SAVEPOINT /i.test(item.trim())));
});
