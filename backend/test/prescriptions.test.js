"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const express = require("express");
const db = require("../db");
const { createDentistPortalRouter } = require("../routes/dentistPortal");
const { createStaffPortalRouter } = require("../routes/staffPortal");
const {
  normalizeItems,
  contentHash,
  clinicalPayload,
  maskEmail,
} = require("../services/prescriptions");
const { generatePrescriptionPdf } = require("../services/prescriptionPdf");

const longSig =
  "Take one capsule after meals with a full glass of water and continue until the bottle is finished even if symptoms improve, unless the dentist instructs otherwise. Avoid alcohol. ".repeat(
    8
  );

test("medication items require explicit clinical fields and are hashed", () => {
  assert.throws(() => normalizeItems([]), /at least one medication/);
  const items = normalizeItems([
    {
      medicationName: "Amoxicillin",
      dosage: "500 mg",
      quantity: "21 capsules",
      frequency: "every 8 hours",
      duration: "7 days",
      sig: "Take after meals",
    },
  ]);
  assert.equal(items[0].medicationName, "Amoxicillin");
  const hash = contentHash(clinicalPayload(items, "note", false));
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(maskEmail("patient@amethyst.com"), "pa***@amethyst.com");
});

test("PDF lists multiple medications from the supplied snapshot only", async () => {
  const buffer = await generatePrescriptionPdf({
    prescriptionNumber: "RX-TEST-0001",
    version: 1,
    contentHash: "abc123def456",
    authorizedAt: "2026-10-30T04:00:00.000Z",
    snapshot: {
      clinic: {
        name: "Amethyst Dental Clinic",
        address: "Grand Central Residences, Cityland, Sultan St., Highway Hills, Mandaluyong, Metro Manila",
        phone: "09109207877",
        email: "amethystdental@gmail.com",
      },
      patient: {
        fullName: "Synthetic Test Patient",
        patientId: "A202610_99",
        age: 32,
        sex: "Female",
        dateOfBirth: "1994-03-18",
      },
      dentist: { fullName: "Dr. Sarah Cruz", specialization: "Orthodontics" },
      includeExtractionAftercare: false,
    },
    items: [
      {
        medicationName: "Amoxicillin",
        strength: "500 mg",
        dosage: "1 capsule",
        quantity: "21",
        frequency: "every 8 hours",
        duration: "7 days",
        sig: "Take after meals",
      },
      {
        medicationName: "Mefenamic acid",
        strength: "500 mg",
        dosage: "1 tablet",
        quantity: "10",
        frequency: "every 8 hours as needed",
        duration: "3 days",
        sig: longSig,
      },
    ],
    clinicalNotes: "Synthetic test prescription",
  });
  assert.ok(buffer.slice(0, 5).toString() === "%PDF-");
  const { PDFParse } = require("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  const parsed = await parser.getText();
  await parser.destroy();
  const text = parsed.text;
  assert.match(text, /Amoxicillin/);
  assert.match(text, /Mefenamic acid/);
  assert.match(text, /Synthetic Test Patient/);
  assert.match(text, /Dr\. Sarah Cruz/);
  assert.match(text, /authenticated[\s\S]*dentist account/i);
  assert.doesNotMatch(text, /Rinse with warm salt water/i);
  const outDir = path.join(__dirname, "..", "..", "screenshots", "prescription-management");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "generated-prescription.pdf"), buffer);
});

async function ensureSchema() {
  const sql = fs.readFileSync(path.join(__dirname, "..", "migrations", "045_prescriptions.sql"), "utf8");
  await db.query(sql);
}

async function listen(app) {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

test("dentist-staff workflow authorizes a version and blocks staff clinical edits", async () => {
  await ensureSchema();
  const suffix = Date.now();
  let dentistRow = await db.query(
    `SELECT id FROM users WHERE LOWER(role) = 'dentist' AND is_verified = TRUE LIMIT 1`
  );
  if (!dentistRow.rows.length) {
    dentistRow = await db.query(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, status, is_verified)
       VALUES ('Sarah', 'Cruz', $1, $2, 'x', 'dentist', 'Active', TRUE)
       RETURNING id`,
      [`sarah${suffix}@amethyst.test`, `63917${String(suffix).slice(-7)}`]
    );
  }
  let staffRow = await db.query(
    `SELECT id FROM users WHERE LOWER(role) = 'staff' AND is_verified = TRUE LIMIT 1`
  );
  if (!staffRow.rows.length) {
    staffRow = await db.query(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, status, is_verified)
       VALUES ('Mina', 'Santos', $1, $2, 'x', 'staff', 'Active', TRUE)
       RETURNING id`,
      [`staff${suffix}@amethyst.test`, `63918${String(suffix).slice(-7)}`]
    );
  }
  const liveDentistId = String(dentistRow.rows[0].id);
  const liveStaffId = String(staffRow.rows[0].id);

  const record = await db.query(
    `INSERT INTO clinic_patient_records (
       record_code, first_name, last_name, email, phone, date_of_birth, gender, linked_user_id, created_by, created_by_role
     ) VALUES ($1, 'Synthetic', 'Patient', $2, '639172222222', '1994-03-18', 'Female', NULL, $3, 'dentist')
     RETURNING id`,
    [`CPR-RX-${suffix}`, `synthetic${suffix}@example.test`, liveDentistId]
  );
  const clinicalRecordId = record.rows[0].id;
  const uploadDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rx-pdf-"));
  const mailLog = [];

  const dentistApp = express();
  dentistApp.use(express.json());
  dentistApp.use(
    "/api/dentist",
    createDentistPortalRouter({
      db,
      authenticateToken(req, _res, next) {
        req.user = { id: liveDentistId, role: "dentist" };
        next();
      },
    })
  );
  const staffApp = express();
  staffApp.use(express.json());
  staffApp.use(
    "/api/staff",
    createStaffPortalRouter({
      db,
      authenticateToken(req, _res, next) {
        req.user = { id: liveStaffId, role: "staff" };
        next();
      },
      passwordResetService: { requestReset: async () => ({}) },
    })
  );

  const dentist = await listen(dentistApp);
  const staff = await listen(staffApp);
  try {
    const created = await fetch(`${dentist.url}/api/dentist/prescriptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clinicalRecordId,
        items: [
          {
            medicationName: "Amoxicillin",
            strength: "500 mg",
            dosage: "1 capsule",
            quantity: "21",
            frequency: "every 8 hours",
            duration: "7 days",
            sig: "Take after meals",
          },
        ],
      }),
    });
    const createdBody = await created.json();
    assert.equal(created.status, 201, createdBody.message || JSON.stringify(createdBody));
    const draft = createdBody.prescription;
    const submitted = await fetch(`${dentist.url}/api/dentist/prescriptions/${draft.id}/submit`, {
      method: "POST",
    });
    assert.equal(submitted.status, 200);
    const staffPatch = await fetch(`${staff.url}/api/staff/prescriptions/${draft.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ medicationName: "Changed", dosage: "x", quantity: "x", frequency: "x", duration: "x", sig: "x" }] }),
    });
    assert.equal(staffPatch.status, 404);
    const unauthorizedSend = await fetch(`${staff.url}/api/staff/prescriptions/${draft.id}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmPrescriptionId: draft.id,
        confirmVersion: 1,
        confirmRecipientMasked: "sy***@example.test",
      }),
    });
    assert.equal(unauthorizedSend.status, 409);
    const authorized = await fetch(`${dentist.url}/api/dentist/prescriptions/${draft.id}/authorize`, {
      method: "POST",
    });
    const authBody = await authorized.json();
    assert.equal(authorized.status, 200, authBody.message || JSON.stringify(authBody));
    assert.equal(authBody.prescription.workflowStatus, "authorized");
    assert.equal(authBody.prescription.emailStatus, "pending");

    const prescriptionsMod = require("../services/prescriptions");
    const originalSend = prescriptionsMod.sendAuthorizedEmail;
    void originalSend;
    const send = await prescriptionsMod.sendAuthorizedEmail(db, {
      staff: { id: liveStaffId },
      prescriptionId: draft.id,
      confirmPrescriptionId: draft.id,
      confirmVersion: 1,
      confirmRecipientMasked: authBody.prescription.recipientEmailMasked,
      uploadDirectory,
      env: { EMAIL_USER: "clinic@gmail.com", EMAIL_PASS: "abcdefghijklmnop", NODE_ENV: "test" },
      sendMail: async (message) => {
        mailLog.push(message);
        return { messageId: "test-message-1" };
      },
    });
    assert.equal(send.emailStatus, "sent");
    assert.equal(mailLog.length, 1);
    assert.match(mailLog[0].subject, /Your Prescription from Amethyst Dental Clinic/);
    assert.equal(mailLog[0].attachments.length, 1);
    const duplicate = await prescriptionsMod.sendAuthorizedEmail(db, {
      staff: { id: liveStaffId },
      prescriptionId: draft.id,
      confirmPrescriptionId: draft.id,
      confirmVersion: 1,
      confirmRecipientMasked: authBody.prescription.recipientEmailMasked,
      uploadDirectory,
      env: { EMAIL_USER: "clinic@gmail.com", EMAIL_PASS: "abcdefghijklmnop", NODE_ENV: "test" },
      sendMail: async (message) => {
        mailLog.push(message);
        return { messageId: "dup" };
      },
    }).catch((error) => error);
    assert.equal(duplicate.status, 409);
    assert.equal(mailLog.length, 1);

    const staffTokenAsDentist = await fetch(`${staff.url}/api/staff/prescriptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clinicalRecordId, items: [] }),
    });
    assert.equal(staffTokenAsDentist.status, 404);
  } finally {
    await dentist.close();
    await staff.close();
  }
});

test("missing prescription tables are created on first list request", async () => {
  await db.query(`
    DROP TABLE IF EXISTS
      prescription_audit_events,
      prescription_email_attempts,
      prescription_pdfs,
      prescription_items,
      prescription_versions,
      prescriptions
    CASCADE
  `);
  const dentistRow = await db.query(
    `SELECT id FROM users WHERE LOWER(role) = 'dentist' AND is_verified = TRUE LIMIT 1`
  );
  assert.ok(dentistRow.rows[0]?.id, "Need a dentist user to list prescriptions");
  const dentistApp = express();
  dentistApp.use(express.json());
  dentistApp.use(
    "/api/dentist",
    createDentistPortalRouter({
      db,
      authenticateToken(req, _res, next) {
        req.user = { id: String(dentistRow.rows[0].id), role: "dentist" };
        next();
      },
    })
  );
  const dentist = await listen(dentistApp);
  try {
    const listed = await fetch(`${dentist.url}/api/dentist/prescriptions`);
    const body = await listed.json();
    assert.equal(listed.status, 200, body.message || JSON.stringify(body));
    assert.ok(Array.isArray(body.prescriptions));
    const tables = await db.query(
      `SELECT COUNT(*)::int AS count
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'prescriptions'`
    );
    assert.equal(tables.rows[0].count, 1);
  } finally {
    await dentist.close();
  }
});
