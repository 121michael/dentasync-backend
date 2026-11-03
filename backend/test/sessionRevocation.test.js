"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const jwt = require("jsonwebtoken");
const express = require("express");
const { isTokenRevokedByPasswordChange } = require("../services/sessionRevocation");
const { authenticateToken } = require("../middleware/authMiddleware");

test("tokens issued before password_changed_at are revoked", () => {
  const changedAt = new Date("2026-11-04T04:00:10.000Z");
  const oldToken = { iat: Math.floor(Date.parse("2026-11-04T04:00:00.000Z") / 1000) };
  const newToken = { iat: Math.floor(Date.parse("2026-11-04T04:00:10.000Z") / 1000) };
  assert.equal(isTokenRevokedByPasswordChange(oldToken, changedAt), true);
  assert.equal(isTokenRevokedByPasswordChange(newToken, changedAt), false);
  assert.equal(isTokenRevokedByPasswordChange(oldToken, null), false);
});

test("password change stamps password_changed_at and rejects the previous token", async (t) => {
  const bcrypt = require("bcrypt");
  const { Pool } = require("pg");
  const { updatePasswordHash } = require("../services/sessionRevocation");
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

    await new Promise((resolve) => setTimeout(resolve, 1100));
    const newHash = await bcrypt.hash("NewPassword123!", 4);
    await updatePasswordHash(pool, { userId: idA, passwordHash: newHash });

    const after = await fetch(url, { headers: { Authorization: `Bearer ${oldToken}` } });
    assert.equal(after.status, 401);

    const freshToken = jwt.sign({ id: idA, role: "patient" }, secret, { expiresIn: "8h" });
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
