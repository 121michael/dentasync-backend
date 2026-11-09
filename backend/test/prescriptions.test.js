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
const { notifyActiveStaff } = require("../services/staffNotifications");
const {
  normalizeItems,
  contentHash,
  clinicalPayload,
  maskEmail,
} = require("../services/prescriptions");
const TEST_SIGNATURE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

function signBody() {
  return JSON.stringify({
    confirmation: "SIGN THIS PRESCRIPTION",
    signaturePng: `data:image/png;base64,${TEST_SIGNATURE_PNG.toString("base64")}`,
  });
}

async function createSigningDentist(label) {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const dentistRow = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, status, is_verified)
     VALUES ('Sarah', 'Cruz', $1, $2, 'x', 'dentist', 'Active', TRUE)
     RETURNING id`,
    [`${label}.${suffix}@amethyst.test`, `639${String(suffix).slice(-9)}`]
  );
  const id = String(dentistRow.rows[0].id);
  await db.query(
    `ALTER TABLE admin_portal_dentist_profiles
     ADD COLUMN IF NOT EXISTS license_verified BOOLEAN NOT NULL DEFAULT FALSE`
  );
  await db.query(
    `INSERT INTO admin_portal_dentist_profiles (
       user_id, license_number, license_verified, professional_designation
     ) VALUES ($1, '12345', TRUE, 'DMD')
     ON CONFLICT (user_id) DO UPDATE SET
       license_number = EXCLUDED.license_number,
       license_verified = TRUE`,
    [id]
  );
  return id;
}

const {
  generatePrescriptionPdf,
  readPdfMediaBoxes,
  PAGE_WIDTH,
  PAGE_HEIGHT,
} = require("../services/prescriptionPdf");

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

test("unsigned or unverified prescriptions are not released", async () => {
  await assert.rejects(
    () =>
      generatePrescriptionPdf({
        prescriptionNumber: "RX-BLOCK",
        version: 1,
        contentHash: "abc",
        authorizedAt: "2026-10-30T04:00:00.000Z",
        snapshot: { dentist: { fullName: "Dr. Sarah Cruz", licenseNumber: "12345", licenseVerified: false } },
        items: [{ medicationName: "Amoxicillin", dosage: "500 mg", quantity: "21", sig: "As directed" }],
        signaturePng: TEST_SIGNATURE_PNG,
      }),
    /license number is missing or not marked verified/
  );
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
      dentist: {
        fullName: "Dr. Sarah Cruz",
        specialization: "Orthodontics",
        professionalDesignation: "DMD",
        licenseNumber: "12345",
        licenseVerified: true,
        ptrNumber: "998877",
      },
      includeExtractionAftercare: false,
    },
    items: [
      {
        medicationName: "Amoxicillin",
        strength: "500 mg",
        dosage: "500 mg",
        quantity: "21",
        sig: "Take 1 cap every 8 hrs for 7 days.",
      },
      {
        medicationName: "Mefenamic acid",
        strength: "500 mg",
        dosage: "500 mg",
        quantity: "10",
        sig: longSig,
      },
    ],
    clinicalNotes: "Synthetic test prescription",
    signaturePng: TEST_SIGNATURE_PNG,
  });
  assert.ok(buffer.slice(0, 5).toString() === "%PDF-");
  const boxes = readPdfMediaBoxes(buffer);
  assert.ok(boxes.length >= 1);
  for (const box of boxes) {
    assert.ok(Math.abs(box.width - PAGE_WIDTH) < 0.6, `width ${box.width}`);
    assert.ok(Math.abs(box.height - PAGE_HEIGHT) < 0.6, `height ${box.height}`);
    assert.ok(box.width < box.height, "portrait A5");
  }
  const { PDFParse } = require("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  const parsed = await parser.getText();
  await parser.destroy();
  const text = parsed.text;
  assert.match(text, /Amoxicillin/);
  assert.match(text, /#21/);
  assert.match(text, /500 mg/);
  assert.doesNotMatch(text, /Dosage:/);
  assert.match(text, /Sig:\s*Take 1 cap every 8 hrs for 7 days/);
  assert.match(text, /Mefenamic acid/);
  assert.match(text, /Synthetic Test/);
  assert.match(text, /Patient/);
  assert.match(text, /Patient's Name/);
  assert.match(text, /Sarah Cruz/i);
  assert.match(text, /DMD/);
  assert.match(text, /License No\. 12345/);
  assert.match(text, /electronic signature/i);
  assert.match(text, /Issued /);
  assert.match(text, /Valid until /);
  assert.match(text, /Valid for 24 hours from the date and time of issuance/);
  assert.doesNotMatch(text, /PTR No/);
  assert.doesNotMatch(text, /valid without signature/i);
  assert.match(text, /Rx/);
  assert.match(text, /0965\.804\.5988/);
  assert.doesNotMatch(text, /Lic\. No\./);
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
  const evidenceDir = path.join(__dirname, "..", "..", "screenshots", "prescription-pad");
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, "a5-two-meds.pdf"), buffer);
  fs.writeFileSync(path.join(evidenceDir, "a5-page-1.jpg"), pages[0]);
  if (pages[1]) fs.writeFileSync(path.join(evidenceDir, "a5-page-2.jpg"), pages[1]);
  const meta = await require("sharp")(pages[0]).metadata();
  assert.ok(meta.width < meta.height, "raster is portrait");
});

test("prescription PDF is ISO A5 portrait and paginates extra medications onto more A5 pages", async () => {
  const many = Array.from({ length: 12 }, (_, index) => ({
    medicationName: `Long named dental analgesic compound ${index + 1} with extended label`,
    dosage: "500mg",
    quantity: "10",
    sig: longSig,
  }));
  const buffer = await generatePrescriptionPdf({
    prescriptionNumber: "RX-TEST-A5-MULTI",
    version: 2,
    contentHash: "ffffffffffffffff",
    authorizedAt: "2026-10-30T04:00:00.000Z",
    snapshot: {
      patient: {
        fullName: "Synthetic Overflow Patient",
        age: 41,
        sex: "Male",
        address: "Unit 1204 Grand Central Residences, Highway Hills, Mandaluyong City",
      },
      dentist: {
        fullName: "Dr. Sarah Cruz",
        specialization: "Orthodontics and Dentalofacial Orthopedics",
        licenseNumber: "12345",
        licenseVerified: true,
      },
    },
    items: many,
    signaturePng: TEST_SIGNATURE_PNG,
  });
  const boxes = readPdfMediaBoxes(buffer);
  assert.ok(boxes.length >= 2, "overflow must create additional A5 pages");
  for (const box of boxes) {
    assert.ok(Math.abs(box.width - 419.53) < 0.6, `width ${box.width}`);
    assert.ok(Math.abs(box.height - 595.28) < 0.6, `height ${box.height}`);
  }
  const { rasterizePrescriptionPdf } = require("../services/prescriptionPdf");
  const pages = await rasterizePrescriptionPdf(buffer);
  assert.ok(pages.length >= 2);
  const evidenceDir = path.join(__dirname, "..", "..", "screenshots", "prescription-pad");
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, "a5-multi.pdf"), buffer);
  pages.slice(0, 3).forEach((page, index) => {
    fs.writeFileSync(path.join(evidenceDir, `a5-multi-page-${index + 1}.jpg`), page);
  });
});

test("extraction aftercare prints clinic pad wording only when flagged", async () => {
  const buffer = await generatePrescriptionPdf({
    prescriptionNumber: "RX-TEST-EXO",
    version: 1,
    contentHash: "hash",
    authorizedAt: "2026-10-30T04:00:00.000Z",
    snapshot: {
      patient: { fullName: "Synthetic Extraction Patient", age: 40, sex: "Male", address: "Test Street" },
      dentist: { fullName: "Dr. Sarah Cruz", licenseNumber: "12345", licenseVerified: true },
      includeExtractionAftercare: true,
    },
    items: [{ medicationName: "Mefenamic acid", dosage: "1 tablet", quantity: "10", sig: "After meals" }],
    signaturePng: TEST_SIGNATURE_PNG,
  });
  const { PDFParse } = require("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  const parsed = await parser.getText();
  await parser.destroy();
  assert.match(parsed.text, /DO'S AND DONT'S AFTER A TOOTH EXTRACTION/);
  assert.match(parsed.text, /Bite firmly on gauze/);
  const { rasterizePrescriptionPdf } = require("../services/prescriptionPdf");
  const pages = await rasterizePrescriptionPdf(buffer);
  assert.ok(pages.length >= 1);
  assert.ok(pages.length <= 2, "short extraction Rx should not spill past a second A5 page");
  const outDir = path.join(__dirname, "..", "..", "screenshots", "prescription-management");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "generated-rx-pad.jpg"), pages[0]);
  const evidenceDir = path.join(__dirname, "..", "..", "screenshots", "prescription-pad");
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, "a5-extraction-aftercare.jpg"), pages[0]);
});

test("PDF keeps a short medicine compact and a long name clear of its quantity", async () => {
  const buffer = await generatePrescriptionPdf({
    prescriptionNumber: "RX-TEST-A5-ALIGN",
    version: 1,
    contentHash: "alignhash",
    authorizedAt: "2026-11-03T08:00:00.000Z",
    snapshot: {
      patient: { fullName: "Alignment Patient", age: 28, sex: "Male", address: "Mandaluyong" },
      dentist: {
        fullName: "Dr. Sarah Cruz",
        ptrNumber: "998877",
        professionalDesignation: "DMD",
        licenseNumber: "12345",
        licenseVerified: true,
      },
    },
    items: [
      { medicationName: "Ibuprofen", dosage: "400 mg", quantity: "8", sig: "Take 1 tablet as prescribed." },
      {
        medicationName: "Amoxicillin clavulanate extended-release",
        dosage: "875 mg",
        quantity: "14",
        sig: "Take 1 tablet every 12 hours with food. Finish the course unless the dentist instructs otherwise.",
      },
    ],
    signaturePng: TEST_SIGNATURE_PNG,
  });
  const boxes = readPdfMediaBoxes(buffer);
  assert.ok(boxes.length >= 1 && boxes.length <= 2);
  assert.ok(Math.abs(boxes[0].width - PAGE_WIDTH) < 0.6);
  assert.ok(Math.abs(boxes[0].height - PAGE_HEIGHT) < 0.6);
  const { PDFParse } = require("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  const parsed = await parser.getText();
  await parser.destroy();
  assert.match(parsed.text, /Ibuprofen/);
  assert.match(parsed.text, /#8/);
  assert.match(parsed.text, /Amoxicillin/);
  assert.match(parsed.text, /clavulanate/);
  assert.match(parsed.text, /extended-/);
  assert.match(parsed.text, /License No\. 12345/);
  assert.doesNotMatch(parsed.text, /PTR No/);
  assert.match(parsed.text, /release/);
  assert.match(parsed.text, /#14/);
  assert.match(parsed.text, /400 mg/);
  assert.doesNotMatch(parsed.text, /Dosage:/);
  const { rasterizePrescriptionPdf } = require("../services/prescriptionPdf");
  const pages = await rasterizePrescriptionPdf(buffer);
  const evidenceDir = path.join(__dirname, "..", "..", "screenshots", "prescription-pad");
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, "a5-alignment.pdf"), buffer);
  fs.writeFileSync(path.join(evidenceDir, "a5-alignment-page-1.jpg"), pages[0]);
});

async function applySqlFile(fileName) {
  const sql = fs.readFileSync(path.join(__dirname, "..", "migrations", fileName), "utf8");
  const statements = sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter((statement) => statement && !statement.split("\n").every((line) => line.trim().startsWith("--")));
  for (const statement of statements) {
    await db.query(statement);
  }
}

async function ensureSchema() {
  await applySqlFile("000_create_users.sql");
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name TEXT`);
  await applySqlFile("009_create_clinical_patient_records.sql");
  await db.query(`ALTER TABLE clinic_patient_records ADD COLUMN IF NOT EXISTS patient_id TEXT`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_portal_dentist_profiles (
      user_id TEXT PRIMARY KEY,
      specialization TEXT,
      schedule_notes TEXT,
      catalog_dentist_id TEXT,
      license_number TEXT,
      ptr_number TEXT,
      professional_designation TEXT
    )
  `);
  const { applyPrescriptionSchema } = require("../services/prescriptionSchema");
  await applyPrescriptionSchema(db);
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
  const liveDentistId = await createSigningDentist("workflow");
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
  let draftNoticeId = null;

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
      notifyStaff: (notification) => notifyActiveStaff(db, notification),
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
      prescriptionUploadDirectory: uploadDirectory,
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
    draftNoticeId = draft.id;
    const noticesFor = async () => {
      const count = await db.query(
        `SELECT COUNT(*)::int AS count
         FROM staff_portal_notifications
         WHERE type = 'prescription' AND entity_id = $1`,
        [String(draft.id)]
      );
      return count.rows[0].count;
    };
    assert.equal(await noticesFor(), 0);
    const submitted = await fetch(`${dentist.url}/api/dentist/prescriptions/${draft.id}/submit`, {
      method: "POST",
    });
    assert.equal(submitted.status, 200);
    const noticesAfterSend = await noticesFor();
    assert.ok(noticesAfterSend >= 1);
    const repeatedSend = await fetch(`${dentist.url}/api/dentist/prescriptions/${draft.id}/submit`, {
      method: "POST",
    });
    assert.notEqual(repeatedSend.status, 200);
    assert.equal(await noticesFor(), noticesAfterSend);
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
    const missingConfirmation = await fetch(`${dentist.url}/api/dentist/prescriptions/${draft.id}/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: signBody().replace("SIGN THIS PRESCRIPTION", "not yet"),
    });
    assert.equal(missingConfirmation.status, 400);
    const staffSign = await fetch(`${staff.url}/api/staff/prescriptions/${draft.id}/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: signBody(),
    });
    assert.equal(staffSign.status, 404);
    const authorized = await fetch(`${dentist.url}/api/dentist/prescriptions/${draft.id}/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: signBody(),
    });
    const authBody = await authorized.json();
    assert.equal(authorized.status, 200, authBody.message || JSON.stringify(authBody));
    assert.equal(authBody.prescription.workflowStatus, "authorized");
    assert.equal(authBody.prescription.emailStatus, "pending");
    assert.ok(authBody.prescription.signedAt);
    assert.equal(authBody.prescription.dentist.licenseNumber, "12345");
    const handedOff = await fetch(`${dentist.url}/api/dentist/prescriptions/${draft.id}/submit`, {
      method: "POST",
    });
    const handedBody = await handedOff.json();
    assert.equal(handedOff.status, 200, handedBody.message || JSON.stringify(handedBody));
    assert.equal(handedBody.prescription.workflowStatus, "authorized");
    assert.ok(
      handedBody.prescription.audit.some(
        (event) => event.action === "submitted_to_staff" && event.version === handedBody.prescription.currentVersion
      )
    );
    const noticesAfterSignedSend = await noticesFor();
    assert.ok(noticesAfterSignedSend > noticesAfterSend);
    const duplicateHandOff = await fetch(`${dentist.url}/api/dentist/prescriptions/${draft.id}/submit`, {
      method: "POST",
    });
    assert.equal(duplicateHandOff.status, 409);
    assert.equal(await noticesFor(), noticesAfterSignedSend);
    const issuedAt = authBody.prescription.authorizedAt;
    const edited = await fetch(`${dentist.url}/api/dentist/prescriptions/${draft.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ medicationName: "Changed", dosage: "1", quantity: "1", sig: "Changed" }],
      }),
    });
    assert.equal(edited.status, 409);

    const prescriptionsMod = require("../services/prescriptions");
    const originalSend = prescriptionsMod.sendAuthorizedEmail;
    void originalSend;
    await prescriptionsMod.generateOrRetrievePdf(db, {
      actorId: liveStaffId,
      actorRole: "staff",
      prescriptionId: draft.id,
      uploadDirectory,
    });
    const again = await prescriptionsMod.generateOrRetrievePdf(db, {
      actorId: liveStaffId,
      actorRole: "staff",
      prescriptionId: draft.id,
      uploadDirectory,
      forceRegenerate: true,
    });
    assert.equal(new Date(again.prescription.authorized_at).toISOString(), new Date(issuedAt).toISOString());
    await prescriptionsMod.retrieveStoredPdf(db, {
      actorId: liveStaffId,
      actorRole: "staff",
      prescriptionId: draft.id,
      uploadDirectory,
      recordView: true,
    });
    await prescriptionsMod.confirmPdfReview(db, {
      staff: { id: liveStaffId },
      prescriptionId: draft.id,
      uploadDirectory,
    });
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
    if (draftNoticeId) {
      await db.query(
        `DELETE FROM staff_portal_notifications
         WHERE type = 'prescription' AND entity_id = $1`,
        [String(draftNoticeId)]
      ).catch(() => {});
    }
    await dentist.close();
    await staff.close();
  }
});

test("missing prescription tables are created on first list request", async () => {
  await db.query(`
    DROP TABLE IF EXISTS
      prescription_signatures,
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
  const liveDentistId = await createSigningDentist("patient");
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
      headers: { "Content-Type": "application/json" },
      body: signBody(),
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

test("staff generate, view, review, and email the stored PDF in order", async () => {
  await ensureSchema();
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-8);
  const staffRow = await db.query(
    `SELECT id FROM users WHERE LOWER(role) = 'staff' AND is_verified = TRUE LIMIT 1`
  );
  assert.ok(staffRow.rows[0]?.id);
  const liveDentistId = await createSigningDentist("review");
  const liveStaffId = String(staffRow.rows[0].id);
  const record = await db.query(
    `INSERT INTO clinic_patient_records (
       record_code, first_name, last_name, email, phone, date_of_birth, gender, linked_user_id, created_by, created_by_role
     ) VALUES ($1, 'Review', 'Patient', $2, '639173333333', '1991-01-11', 'Male', NULL, $3, 'dentist')
     RETURNING id`,
    [`CPR-RV-${suffix}`, `review${suffix}@example.test`, liveDentistId]
  );
  const uploadDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rx-review-"));
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
      prescriptionUploadDirectory: uploadDirectory,
    })
  );
  const dentist = await listen(dentistApp);
  const staff = await listen(staffApp);
  try {
    const created = await fetch(`${dentist.url}/api/dentist/prescriptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clinicalRecordId: record.rows[0].id,
        items: [
          {
            medicationName: "Ibuprofen 400 mg",
            dosage: "1 tablet",
            quantity: "10",
            sig: "Take after meals every 8 hours as needed for pain",
          },
        ],
      }),
    });
    const createdBody = await created.json();
    assert.equal(created.status, 201, createdBody.message);
    const id = createdBody.prescription.id;
    assert.equal((await fetch(`${dentist.url}/api/dentist/prescriptions/${id}/submit`, { method: "POST" })).status, 200);

    const generateUnauthorized = await fetch(`${staff.url}/api/staff/prescriptions/${id}/generate`, { method: "POST" });
    assert.equal(generateUnauthorized.status, 409);

    const viewUnauthorized = await fetch(`${staff.url}/api/staff/prescriptions/${id}/pdf?inline=1`);
    assert.equal(viewUnauthorized.status, 409);

    assert.equal(
      (
        await fetch(`${dentist.url}/api/dentist/prescriptions/${id}/authorize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: signBody(),
        })
      ).status,
      200
    );

    const viewBeforeGenerate = await fetch(`${staff.url}/api/staff/prescriptions/${id}/pdf?inline=1`);
    assert.equal(viewBeforeGenerate.status, 409);

    const prepareBeforePdf = await fetch(`${staff.url}/api/staff/prescriptions/${id}/prepare-send`, { method: "POST" });
    assert.equal(prepareBeforePdf.status, 409);

    const generated = await fetch(`${staff.url}/api/staff/prescriptions/${id}/generate`, { method: "POST" });
    const generatedBody = await generated.json();
    assert.equal(generated.status, 200, generatedBody.message);
    assert.equal(generatedBody.prescription.hasGeneratedPdf, true);
    assert.equal(generatedBody.prescription.pdfReviewValid, false);
    assert.match(generatedBody.message, /generated and stored/i);

    const reviewBeforeView = await fetch(`${staff.url}/api/staff/prescriptions/${id}/confirm-review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmPdfId: generatedBody.prescription.generatedPdf.id }),
    });
    assert.equal(reviewBeforeView.status, 409);

    const viewed = await fetch(`${staff.url}/api/staff/prescriptions/${id}/pdf?inline=1`);
    assert.equal(viewed.status, 200);
    assert.equal(viewed.headers.get("content-type"), "application/pdf");
    assert.match(String(viewed.headers.get("cache-control") || ""), /private/);
    const pdfBytes = Buffer.from(await viewed.arrayBuffer());
    assert.ok(pdfBytes.slice(0, 5).toString() === "%PDF-");

    const reviewed = await fetch(`${staff.url}/api/staff/prescriptions/${id}/confirm-review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmPdfId: generatedBody.prescription.generatedPdf.id }),
    });
    const reviewedBody = await reviewed.json();
    assert.equal(reviewed.status, 200, reviewedBody.message);
    assert.equal(reviewedBody.prescription.pdfReviewValid, true);

    const regenerated = await fetch(`${staff.url}/api/staff/prescriptions/${id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regenerate: true }),
    });
    const regeneratedBody = await regenerated.json();
    assert.equal(regenerated.status, 200, regeneratedBody.message);
    assert.equal(regeneratedBody.prescription.pdfReviewValid, false);

    const prepareStaleReview = await fetch(`${staff.url}/api/staff/prescriptions/${id}/prepare-send`, { method: "POST" });
    assert.equal(prepareStaleReview.status, 409);

    assert.equal((await fetch(`${staff.url}/api/staff/prescriptions/${id}/pdf?inline=1`)).status, 200);
    const rereviewed = await fetch(`${staff.url}/api/staff/prescriptions/${id}/confirm-review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmPdfId: regeneratedBody.prescription.generatedPdf.id }),
    });
    assert.equal(rereviewed.status, 200);

    const prepared = await fetch(`${staff.url}/api/staff/prescriptions/${id}/prepare-send`, { method: "POST" });
    const preparedBody = await prepared.json();
    assert.equal(prepared.status, 200, preparedBody.message);
    assert.equal(preparedBody.confirmation.pdfId, regeneratedBody.prescription.generatedPdf.id);
    assert.match(preparedBody.confirmation.medications[0].medicationName, /Ibuprofen/);
  } finally {
    await dentist.close();
    await staff.close();
    fs.rmSync(uploadDirectory, { recursive: true, force: true });
  }
});
