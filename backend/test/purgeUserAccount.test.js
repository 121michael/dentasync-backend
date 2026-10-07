"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  canPermanentlyDeleteAccount,
  purgeUserAccount,
} = require("../services/purgeUserAccount");

test("pending or archived non-admin accounts can be purged", () => {
  assert.equal(
    canPermanentlyDeleteAccount({
      role: "patient",
      is_verified: false,
      status: "Pending",
      is_archived: false,
    }),
    true
  );
  assert.equal(
    canPermanentlyDeleteAccount({
      role: "staff",
      is_verified: true,
      status: "Active",
      is_archived: true,
    }),
    true
  );
  assert.equal(
    canPermanentlyDeleteAccount({
      role: "patient",
      is_verified: true,
      status: "Active",
      is_archived: false,
    }),
    false
  );
  assert.equal(
    canPermanentlyDeleteAccount({
      role: "admin",
      is_verified: true,
      status: "Active",
      is_archived: true,
    }),
    false
  );
});

test("purgeUserAccount deletes the users row after related cleanup", async () => {
  const statements = [];
  const client = {
    async query(sql, params = []) {
      statements.push({ sql, params });
      if (/DELETE FROM users/i.test(sql)) {
        return { rows: [{ id: "9", email: "gone@example.test", role: "patient" }] };
      }
      return { rows: [] };
    },
  };

  const removed = await purgeUserAccount(client, 9);
  assert.equal(removed.email, "gone@example.test");
  assert.ok(statements.some((entry) => /otp_verification_requests/i.test(entry.sql)));
  assert.ok(statements.some((entry) => /DELETE FROM users/i.test(entry.sql)));
  assert.deepEqual(statements.at(-1).params, ["9"]);
});
