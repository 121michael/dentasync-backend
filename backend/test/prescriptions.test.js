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
const { createPatientPortalRouter } = require("../routes/patientPortal");
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
      medicationName: "Amoxicillin 500 mg",
      dosage: "1 capsule",
      quantity: "21 capsules",
      sig: "Take after meals every 8 hours for 7 days",
    },
  ]);
  assert.equal(items[0].medicationName, "Amoxicillin 500 mg");
  assert.equal(items[0].frequency, "");
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
        medicationName: "Amoxicillin 500 mg",
        dosage: "1 capsule",
        quantity: "21",
        sig: "Take after meals",
      },
      {
        medicationName: "Mefenamic acid 500 mg",
        dosage: "1 tablet",
        quantity: "10",
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
  assert.match(text, /Amoxicillin 500 mg/);
  assert.match(text, /Mefenamic acid 500 mg/);
  assert.match(text, /Synthetic Test Patient/);
  assert.match(text, /Sarah Cruz/i);
  assert.match(text, /Rx/);
  assert.match(text, /authenticated[\s\S]*dentist account/i);
  assert.doesNotMatch(text, /EVIE SUNGA/i);
  assert.doesNotMatch(text, /DO'S AND DONT'S AFTER A TOOTH EXTRACTION/);
  const outDir = path.join(__dirname, "..", "..", "screenshots", "prescription-management");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "generated-prescription.pdf"), buffer);
  const { rasterizePrescriptionPdf } = require("../services/prescriptionPdf");
  const pages = await rasterizePrescriptionPdf(buffer);
  assert.ok(pages.length >= 1);
  assert.equal(pages[0][0], 0xff);
  assert.equal(pages[0][1], 0xd8);
  fs.writeFileSync(path.join(outDir, "generated-prescription-page-1.jpg"), pages[0]);
});

test("extraction aftercare prints clinic pad wording only when flagged", async () => {
  const buffer = await generatePrescriptionPdf({
    prescriptionNumber: "RX-TEST-EXO",
    version: 1,
    contentHash: "hash",
    authorizedAt: "2026-10-30T04:00:00.000Z",
    snapshot: {
      patient: { fullName: "Synthetic Extraction Patient", age: 40, sex: "Male", address: "Test Street" },
      dentist: { fullName: "Dr. Sarah Cruz" },
      includeExtractionAftercare: true,
    },
    items: [{ medicationName: "Mefenamic acid", dosage: "1 tablet", quantity: "10", sig: "After meals" }],
  });
  const { PDFParse } = require("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  const parsed = await parser.getText();
  await parser.destroy();
  assert.match(parsed.text, /DO'S AND DONT'S AFTER A TOOTH EXTRACTION/);
  assert.match(parsed.text, /Bite firmly on gauze/);
  const { rasterizePrescriptionPdf } = require("../services/prescriptionPdf");
  const pages = await rasterizePrescriptionPdf(buffer);
  assert.equal(pages.length, 1, "short extraction Rx should stay on one page");
  const outDir = path.join(__dirname, "..", "..", "screenshots", "prescription-management");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "generated-rx-pad.jpg"), pages[0]);
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
            medicationName: "Amoxicillin 500 mg",
            dosage: "1 capsule",
            quantity: "21",
            sig: "Take after meals every 8 hours for 7 days",
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

test("patient portal shows owned prescriptions and hides drafts from other patients", async () => {
  await ensureSchema();
  const suffix = Date.now();
  const dentistRow = await db.query(
    `SELECT id FROM users WHERE LOWER(role) = 'dentist' AND is_verified = TRUE LIMIT 1`
  );
  const liveDentistId = String(dentistRow.rows[0].id);
  const patientRow = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, status, is_verified)
     VALUES ('Lina', 'Reyes', $1, $2, 'x', 'patient', 'Active', TRUE)
     RETURNING id`,
    [`lina${suffix}@example.test`, `63919${String(suffix).slice(-7)}`]
  );
  const otherRow = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, status, is_verified)
     VALUES ('Other', 'Patient', $1, $2, 'x', 'patient', 'Active', TRUE)
     RETURNING id`,
    [`other${suffix}@example.test`, `63916${String(suffix).slice(-7)}`]
  );
  const patientId = String(patientRow.rows[0].id);
  const otherId = String(otherRow.rows[0].id);
  const record = await db.query(
    `INSERT INTO clinic_patient_records (
       record_code, first_name, last_name, email, phone, date_of_birth, gender, linked_user_id, created_by, created_by_role
     ) VALUES ($1, 'Lina', 'Reyes', $2, '639193333333', '1996-01-12', 'Female', $3, $4, 'dentist')
     RETURNING id`,
    [`CPR-RX-PT-${suffix}`, `lina${suffix}@example.test`, patientId, liveDentistId]
  );
  const clinicalRecordId = record.rows[0].id;

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
  const patientApp = express();
  patientApp.use(express.json());
  patientApp.use(
    "/api/patient",
    createPatientPortalRouter({
      db,
      jwtSecret: "test-patient-rx",
      authenticateToken(req, _res, next) {
        req.user = { id: patientId, role: "patient" };
        next();
      },
    })
  );
  const otherApp = express();
  otherApp.use(express.json());
  otherApp.use(
    "/api/patient",
    createPatientPortalRouter({
      db,
      jwtSecret: "test-patient-rx",
      authenticateToken(req, _res, next) {
        req.user = { id: otherId, role: "patient" };
        next();
      },
    })
  );

  const dentist = await listen(dentistApp);
  const patient = await listen(patientApp);
  const other = await listen(otherApp);
  try {
    const created = await fetch(`${dentist.url}/api/dentist/prescriptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clinicalRecordId,
        items: [
          {
            medicationName: "Amoxicillin 500 mg",
            dosage: "1 capsule",
            quantity: "21",
            sig: "Take after meals every 8 hours for 7 days",
          },
        ],
      }),
    });
    const createdBody = await created.json();
    assert.equal(created.status, 201, createdBody.message);
    const rxId = createdBody.prescription.id;

    const draftList = await fetch(`${patient.url}/api/patient/prescriptions`);
    const draftBody = await draftList.json();
    assert.equal(draftList.status, 200, draftBody.message);
    assert.equal(draftBody.prescriptions.some((row) => row.id === rxId), false);

    const submitted = await fetch(`${dentist.url}/api/dentist/prescriptions/${rxId}/submit`, {
      method: "POST",
    });
    assert.equal(submitted.status, 200);

    const pendingList = await fetch(`${patient.url}/api/patient/prescriptions?patientId=${otherId}`);
    const pendingBody = await pendingList.json();
    assert.equal(pendingList.status, 200);
    const pending = pendingBody.prescriptions.find((row) => row.id === rxId);
    assert.ok(pending);
    assert.equal(pending.workflowLabel, "Pending Authorization");
    assert.equal(pending.canViewDocument, false);
    assert.equal(pending.medications.length, 0);

    const unauthorizedPdf = await fetch(`${patient.url}/api/patient/prescriptions/${rxId}/pdf`);
    assert.equal(unauthorizedPdf.status, 409);

    const authorized = await fetch(`${dentist.url}/api/dentist/prescriptions/${rxId}/authorize`, {
      method: "POST",
    });
    assert.equal(authorized.status, 200);

    const readyList = await fetch(`${patient.url}/api/patient/prescriptions`);
    const readyBody = await readyList.json();
    const ready = readyBody.prescriptions.find((row) => row.id === rxId);
    assert.equal(ready.workflowLabel, "Authorized");
    assert.equal(ready.emailLabel, "Email pending");
    assert.equal(ready.canViewDocument, true);
    assert.equal(ready.medications[0].medicationName, "Amoxicillin 500 mg");
    assert.equal(ready.dentistName.includes("Sarah") || ready.dentistName.includes("Cruz"), true);

    const pdf = await fetch(`${patient.url}/api/patient/prescriptions/${rxId}/pdf`);
    assert.equal(pdf.status, 200, await pdf.clone().text().then((text) => text.slice(0, 180)));
    assert.equal(pdf.headers.get("content-type"), "application/pdf");

    const stolen = await fetch(`${other.url}/api/patient/prescriptions/${rxId}/pdf`);
    assert.equal(stolen.status, 404);
    const otherList = await fetch(`${other.url}/api/patient/prescriptions`);
    const otherBody = await otherList.json();
    assert.equal(otherBody.prescriptions.some((row) => row.id === rxId), false);
  } finally {
    await dentist.close();
    await patient.close();
    await other.close();
  }
});
