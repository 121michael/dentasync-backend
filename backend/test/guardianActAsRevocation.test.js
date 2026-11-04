"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const jwt = require("jsonwebtoken");
const express = require("express");
const { Pool } = require("pg");
const { authenticateToken, guardianLinkedToDependent } = require("../middleware/authMiddleware");
const { accessTokenPayload } = require("../services/sessionRevocation");

function adminPool() {
  return new Pool({
    user: process.env.DB_USER || "postgres",
    host: process.env.DB_HOST || "127.0.0.1",
    database: process.env.DB_NAME || "postgres",
    password: process.env.DB_PASSWORD || "postgres",
    port: Number(process.env.DB_PORT || 5432),
  });
}

test("unlinking a dependent revokes an existing act-as session including file access", async (t) => {
  const pool = adminPool();
  const stamp = `${process.pid}${Date.now()}`.slice(-12);
  const emails = {
    guardian: `guard-${stamp}@example.test`,
    childA: `child-a-${stamp}@example.test`,
    childB: `child-b-${stamp}@example.test`,
  };
  const ids = {};
  const files = {};

  try {
    await pool.query("SELECT 1");
  } catch {
    t.skip("PostgreSQL is not available for guardian revocation tests");
    await pool.end().catch(() => {});
    return;
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS patient_portal_dependents (
        id BIGSERIAL PRIMARY KEY,
        guardian_user_id TEXT NOT NULL,
        dependent_user_id TEXT NOT NULL,
        relationship TEXT NOT NULL DEFAULT 'dependent',
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`ALTER TABLE patient_portal_dependents ADD COLUMN IF NOT EXISTS approval_status TEXT`);
    await pool.query(`ALTER TABLE patient_portal_dependents ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS patient_portal_documents (
        id UUID PRIMARY KEY,
        user_id TEXT NOT NULL,
        document_type TEXT NOT NULL,
        original_name TEXT NOT NULL,
        stored_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        byte_size BIGINT NOT NULL
      )
    `);

    const inserted = await pool.query(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
       VALUES
         ('Guard', 'Ian', $1, $2, '!', 'patient', TRUE, 'Active'),
         ('Child', 'A', $3, $4, '!', 'patient', TRUE, 'Active'),
         ('Child', 'B', $5, $6, '!', 'patient', TRUE, 'Active')
       RETURNING id, email`,
      [
        emails.guardian,
        `63911${stamp.slice(0, 8)}`,
        emails.childA,
        `63912${stamp.slice(0, 8)}`,
        emails.childB,
        `63913${stamp.slice(0, 8)}`,
      ]
    );
    for (const row of inserted.rows) {
      if (row.email === emails.guardian) ids.guardian = row.id;
      if (row.email === emails.childA) ids.childA = row.id;
      if (row.email === emails.childB) ids.childB = row.id;
    }

    await pool.query(
      `INSERT INTO patient_portal_dependents (
         guardian_user_id, dependent_user_id, relationship, approval_status, removed_at
       ) VALUES
         ($1, $2, 'child', 'approved', NULL),
         ($1, $3, 'child', 'approved', NULL)`,
      [ids.guardian, ids.childA, ids.childB]
    );

    files.childA = crypto.randomUUID();
    files.childB = crypto.randomUUID();
    await pool.query(
      `INSERT INTO patient_portal_documents (
         id, user_id, document_type, original_name, stored_name, mime_type, byte_size
       ) VALUES
         ($1, $2, 'hmo_authorization', 'a.pdf', 'a.pdf', 'application/pdf', 12),
         ($3, $4, 'hmo_authorization', 'b.pdf', 'b.pdf', 'application/pdf', 12)`,
      [files.childA, ids.childA, files.childB, ids.childB]
    );

    assert.equal(await guardianLinkedToDependent(ids.guardian, ids.childA, pool), true);
    assert.equal(await guardianLinkedToDependent(ids.guardian, ids.childB, pool), true);

    const secret = require("../lib/securityConfig").resolveAppSecrets(process.env).jwtSecret;
    const actAsA = jwt.sign(
      accessTokenPayload({ id: ids.guardian, role: "patient", actAsUserId: ids.childA }),
      secret,
      { expiresIn: "8h" }
    );
    const actAsB = jwt.sign(
      accessTokenPayload({ id: ids.guardian, role: "patient", actAsUserId: ids.childB }),
      secret,
      { expiresIn: "8h" }
    );

    const app = express();
    app.get("/protected", authenticateToken, (req, res) => {
      res.json({ userId: String(req.user.id), actingAs: req.actingAs, actAsUserId: req.actAsUserId });
    });
    app.get("/documents/:id", authenticateToken, async (req, res) => {
      const result = await pool.query(
        `SELECT id FROM patient_portal_documents WHERE id = $1 AND user_id::text = $2`,
        [req.params.id, String(req.user.id)]
      );
      if (!result.rows.length) {
        return res.status(404).json({ message: "Document not found." });
      }
      return res.json({ id: result.rows[0].id });
    });

    const server = await new Promise((resolve) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    t.after(
      () =>
        new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    );
    const origin = `http://127.0.0.1:${server.address().port}`;

    const before = await fetch(`${origin}/protected`, { headers: { Authorization: `Bearer ${actAsA}` } });
    assert.equal(before.status, 200);
    assert.equal(String((await before.json()).userId), String(ids.childA));

    const fileBefore = await fetch(`${origin}/documents/${files.childA}`, {
      headers: { Authorization: `Bearer ${actAsA}` },
    });
    assert.equal(fileBefore.status, 200);

    await pool.query(
      `UPDATE patient_portal_dependents
       SET removed_at = CURRENT_TIMESTAMP
       WHERE guardian_user_id::text = $1 AND dependent_user_id::text = $2`,
      [ids.guardian, ids.childA]
    );

    assert.equal(await guardianLinkedToDependent(ids.guardian, ids.childA, pool), false);
    assert.equal(await guardianLinkedToDependent(ids.guardian, ids.childB, pool), true);

    const after = await fetch(`${origin}/protected`, { headers: { Authorization: `Bearer ${actAsA}` } });
    assert.equal(after.status, 403);
    assert.equal((await after.json()).code, "ACT_AS_LINK_REVOKED");

    const fileAfter = await fetch(`${origin}/documents/${files.childA}`, {
      headers: { Authorization: `Bearer ${actAsA}` },
    });
    assert.equal(fileAfter.status, 403);

    const stillLinked = await fetch(`${origin}/protected`, { headers: { Authorization: `Bearer ${actAsB}` } });
    assert.equal(stillLinked.status, 200);
    assert.equal(String((await stillLinked.json()).userId), String(ids.childB));

    const otherFile = await fetch(`${origin}/documents/${files.childB}`, {
      headers: { Authorization: `Bearer ${actAsB}` },
    });
    assert.equal(otherFile.status, 200);
  } finally {
    if (files.childA) await pool.query("DELETE FROM patient_portal_documents WHERE id = $1", [files.childA]).catch(() => {});
    if (files.childB) await pool.query("DELETE FROM patient_portal_documents WHERE id = $1", [files.childB]).catch(() => {});
    if (ids.guardian) {
      await pool.query("DELETE FROM patient_portal_dependents WHERE guardian_user_id::text = $1", [ids.guardian]).catch(() => {});
    }
    for (const id of Object.values(ids)) {
      await pool.query("DELETE FROM users WHERE id = $1", [id]).catch(() => {});
    }
    await pool.end().catch(() => {});
  }
});
