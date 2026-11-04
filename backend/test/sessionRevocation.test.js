"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const jwt = require("jsonwebtoken");
const express = require("express");
const {
  accessTokenPayload,
  isTokenRevokedByPasswordChange,
  updatePasswordHash,
} = require("../services/sessionRevocation");
const { authenticateToken } = require("../middleware/authMiddleware");
const { applyPasswordResetSchema, assertPasswordChangedAtReady } = require("../services/passwordResetSchema");

test("tokens issued before password_changed_at are revoked", () => {
  const changedAt = new Date("2026-11-04T04:00:10.400Z");
  const oldToken = { iat: Math.floor(Date.parse("2026-11-04T04:00:00.000Z") / 1000) };
  const newToken = { iat: Math.floor(Date.parse("2026-11-04T04:00:11.000Z") / 1000) };
  assert.equal(isTokenRevokedByPasswordChange(oldToken, changedAt), true);
  assert.equal(isTokenRevokedByPasswordChange(newToken, changedAt), false);
  assert.equal(isTokenRevokedByPasswordChange(oldToken, null), false);
});

test("a token issued in the same second as the password change is revoked unless it carries pwdv", () => {
  const changedAt = new Date("2026-11-04T04:00:10.400Z");
  const sameSecond = Math.floor(changedAt.getTime() / 1000);
  assert.equal(isTokenRevokedByPasswordChange({ iat: sameSecond }, changedAt), true);
  assert.equal(
    isTokenRevokedByPasswordChange({ iat: sameSecond, pwdv: String(changedAt.getTime()) }, changedAt),
    false
  );
  assert.equal(isTokenRevokedByPasswordChange({ iat: sameSecond, pwdv: "1" }, changedAt), true);
});

test("missing password_changed_at schema does not update the hash", async () => {
  const missing = Object.assign(new Error('column "password_changed_at" of relation "users" does not exist'), {
    code: "42703",
  });
  await assert.rejects(
    () =>
      updatePasswordHash(
        {
          async query() {
            throw missing;
          },
        },
        { userId: "user-1", passwordHash: "hash" }
      ),
    (error) => error.code === "SCHEMA_PASSWORD_CHANGED_AT" && error.status === 503
  );
});

test("migration 003 is the password revocation schema check", async () => {
  const statements = [];
  const db = {
    async query(sql) {
      statements.push(String(sql));
      if (/password_changed_at FROM users LIMIT 0/i.test(sql)) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  const applied = await applyPasswordResetSchema(db);
  assert.equal(applied.file, "migrations/003_create_password_reset_requests.sql");
  assert.match(statements[0], /password_changed_at TIMESTAMPTZ/i);
  await assertPasswordChangedAtReady(db);
  assert.match(statements.at(-1), /SELECT password_changed_at FROM users LIMIT 0/i);
});

test("password change stamps password_changed_at and rejects the previous token", async (t) => {
  const bcrypt = require("bcrypt");
  const { Pool } = require("pg");
  const pool = new Pool({
    user: process.env.DB_USER || "postgres",
    host: process.env.DB_HOST || "127.0.0.1",
    database: process.env.DB_NAME || "postgres",
    password: process.env.DB_PASSWORD || "postgres",
    port: Number(process.env.DB_PORT || 5432),
  });
    const stamp = `${process.pid}${Date.now()}`.slice(-12);
    const emailA = `revoke-a-${stamp}@example.test`;
    const emailB = `revoke-b-${stamp}@example.test`;
  let idA;
  let idB;
  try {
    await pool.query("SELECT 1");
  } catch {
    t.skip("PostgreSQL is not available for session revocation tests");
    await pool.end().catch(() => {});
    return;
  }

  try {
    await applyPasswordResetSchema(pool);
    const hash = await bcrypt.hash("OldPassword123!", 4);
    const inserted = await pool.query(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
       VALUES
         ('Revoke', 'Alpha', $1, $2, $3, 'patient', TRUE, 'Active'),
         ('Revoke', 'Beta', $4, $5, $3, 'patient', TRUE, 'Active')
       RETURNING id, email`,
      [emailA, `63917${stamp.slice(0, 8)}`, hash, emailB, `63918${stamp.slice(0, 8)}`]
    );
    idA = inserted.rows.find((row) => row.email === emailA).id;
    idB = inserted.rows.find((row) => row.email === emailB).id;

    const secret = require("../lib/securityConfig").resolveAppSecrets(process.env).jwtSecret;
    const oldToken = jwt.sign({ id: idA, role: "patient" }, secret, { expiresIn: "8h" });
    const otherToken = jwt.sign({ id: idB, role: "patient" }, secret, { expiresIn: "8h" });

    const app = express();
    app.get("/protected", authenticateToken, (req, res) => res.json({ id: req.user.id }));
    const server = await new Promise((resolve) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    t.after(
      () =>
        new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    );
    const url = `http://127.0.0.1:${server.address().port}/protected`;

    const before = await fetch(url, { headers: { Authorization: `Bearer ${oldToken}` } });
    assert.equal(before.status, 200);

    const newHash = await bcrypt.hash("NewPassword123!", 4);
    const updated = await updatePasswordHash(pool, { userId: idA, passwordHash: newHash });
    const changedAt = updated.rows[0].password_changed_at;

    const after = await fetch(url, { headers: { Authorization: `Bearer ${oldToken}` } });
    assert.equal(after.status, 401);

    const sameSecondOld = jwt.sign({ id: idA, role: "patient" }, secret, {
      expiresIn: "8h",
      noTimestamp: false,
    });
    const decodedOld = jwt.decode(sameSecondOld);
    assert.equal(isTokenRevokedByPasswordChange(decodedOld, changedAt), true);

    const freshToken = jwt.sign(
      accessTokenPayload({ id: idA, role: "patient", passwordChangedAt: changedAt }),
      secret,
      { expiresIn: "8h" }
    );
    const fresh = await fetch(url, { headers: { Authorization: `Bearer ${freshToken}` } });
    assert.equal(fresh.status, 200);

    const other = await fetch(url, { headers: { Authorization: `Bearer ${otherToken}` } });
    assert.equal(other.status, 200);
  } finally {
    if (idA) await pool.query("DELETE FROM users WHERE id = $1", [idA]).catch(() => {});
    if (idB) await pool.query("DELETE FROM users WHERE id = $1", [idB]).catch(() => {});
    await pool.end().catch(() => {});
  }
});
