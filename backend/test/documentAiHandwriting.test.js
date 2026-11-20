"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const dotenv = require("dotenv");
const express = require("express");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const {
  setGoogleCloudOcrFetch,
  clearGoogleCloudOcrCache,
  DOCUMENT_AI_PROCESSOR_MESSAGE,
} = require("../services/googleCloudOcr");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const HANDWRITING_TEXT = `NAME
Maria Santos
ADDRESS
Mandaluyong City
TELEPHONE
09171234567
AGE
28
DESCRIPTION
ORAL PROPHYLAXIS
DATE
SEPT 7, 2024
TOOTH NO.
14
AMOUNT
800`;

const dbName = `ds_docai_${process.pid}_${Date.now().toString(36)}`;
const adminPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || "localhost",
  database: "postgres",
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
});

test("local PostgreSQL accepts a disposable Document AI test database", async () => {
  const ping = await adminPool.query("SELECT 1 AS ok");
  assert.equal(Number(ping.rows[0].ok), 1);
});

function jsonResponse(payload, status = 200) {
  const text = JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
    async text() {
      return text;
    },
  };
}

function mockDocumentAi(mode = "ok") {
  return async (url) => {
    const href = String(url);
    if (href.includes("oauth2.googleapis.com/token")) {
      return jsonResponse({ access_token: "test-token", expires_in: 3600 });
    }
    if (href.includes("documentai.googleapis.com")) {
      if (mode === "fail") {
        return jsonResponse({ error: { message: "processor unavailable" } }, 503);
      }
      return jsonResponse({
        document: {
          text: HANDWRITING_TEXT,
          pages: [{ layout: { confidence: 0.9 }, tokens: [] }],
        },
      });
    }
    return jsonResponse({ error: { message: "unexpected" } }, 500);
  };
}

async function writeFormPng() {
  const sharp = require("sharp");
  const svg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">
  <rect width="100%" height="100%" fill="#fff"/>
  <text x="20" y="40" font-size="18">NAME Maria Santos</text>
</svg>`);
  const filePath = path.join(os.tmpdir(), `docai-form-${process.pid}-${Date.now()}.png`);
  await sharp(svg).png().toFile(filePath);
  return filePath;
}

test("handwritten Document AI extract, save, duplicate skip, and OCR failure", async (t) => {
  process.env.DB_NAME = dbName;
  delete process.env.GEMINI_API_KEY;
  process.env.GOOGLE_CLOUD_API_KEY = "synthetic-document-ai";
  process.env.GOOGLE_CLOUD_PROJECT = "clinic-sync";
  process.env.GOOGLE_DOCUMENT_AI_LOCATION = "us";
  process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID = "proc-handwriting";

  await adminPool.query(`CREATE DATABASE ${dbName}`);
  const db = require("../db");
  db.on("error", () => {});
  const { resolveAppSecrets } = require("../lib/securityConfig");
  const { applyClinicBranchSchema } = require("../services/clinicBranches");
  const { createAdminPortalRouter } = require("../routes/adminPortal");
  const { authenticateToken } = require("../middleware/authMiddleware");

  let server;
  t.after(async () => {
    setGoogleCloudOcrFetch(null);
    clearGoogleCloudOcrCache();
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.end();
    await adminPool.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
    await adminPool.end();
  });

  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "000_create_users.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "005_create_admin_portal.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "007_create_document_sync.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "008_create_admin_command_center.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "009_create_clinical_patient_records.sql"), "utf8"));
  await db.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
    ALTER TABLE admin_portal_document_sync_jobs
      ADD COLUMN IF NOT EXISTS approved_by TEXT,
      ADD COLUMN IF NOT EXISTS approved_by_name TEXT,
      ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
    ALTER TABLE clinic_patient_treatments
      ADD COLUMN IF NOT EXISTS duration_minutes INTEGER,
      ADD COLUMN IF NOT EXISTS tooth_number TEXT,
      ADD COLUMN IF NOT EXISTS diagnosis_notes TEXT,
      ADD COLUMN IF NOT EXISTS procedure_details TEXT,
      ADD COLUMN IF NOT EXISTS amount_charged NUMERIC(12, 2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12, 2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS appointment_id BIGINT,
      ADD COLUMN IF NOT EXISTS queue_entry_id BIGINT,
      ADD COLUMN IF NOT EXISTS visit_sequence INTEGER,
      ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_by TEXT;
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS clinic_dental_chart_entries (
      id BIGSERIAL PRIMARY KEY,
      clinical_record_id BIGINT,
      tooth_number TEXT NOT NULL,
      condition_label TEXT,
      notes TEXT,
      created_by TEXT,
      created_by_role TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (clinical_record_id, tooth_number)
    )
  `);
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "014_dental_chart_enrichment.sql"), "utf8"));
  await applyClinicBranchSchema(db);
  await db.query(
    `ALTER TABLE clinic_patient_treatments
     ADD COLUMN IF NOT EXISTS originating_branch_id BIGINT REFERENCES clinic_branches (id)`
  );

  const admin = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Ada', 'Admin', 'ada.docai@example.test', '09170000001', 'synthetic-hash', 'admin', TRUE, 'Active')
     RETURNING id`
  );
  const branch = await db.query(`SELECT id FROM clinic_branches WHERE is_main LIMIT 1`);
  const branchId = branch.rows[0].id;
  const adminId = admin.rows[0].id;

  const app = express();
  app.use(express.json({ limit: "12mb" }));
  app.use(
    "/api/admin",
    createAdminPortalRouter({
      db,
      authenticateToken,
      passwordResetService: null,
      notifyAdmin: async () => {},
    })
  );
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { jwtSecret } = resolveAppSecrets(process.env);
  const token = jwt.sign({ id: String(adminId), role: "admin" }, jwtSecret, { expiresIn: "1h" });

  async function uploadScan(filePath, mode = "ok") {
    clearGoogleCloudOcrCache();
    setGoogleCloudOcrFetch(mockDocumentAi(mode));
    const buffer = fs.readFileSync(filePath);
    const form = new FormData();
    form.set("sourceType", "hard_copy_scan");
    form.set("document", new Blob([buffer], { type: "image/png" }), "synthetic-handwritten.png");
    const response = await fetch(`${base}/api/admin/sync/documents`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, origin: "http://127.0.0.1:5173" },
      body: form,
    });
    const body = await response.json();
    return { status: response.status, body };
  }

  const filePath = await writeFormPng();
  t.after(() => fs.unlink(filePath, () => {}));

  const patientsBefore = await db.query(`SELECT COUNT(*)::int AS count FROM clinic_patient_records`);
  const treatmentsBefore = await db.query(`SELECT COUNT(*)::int AS count FROM clinic_patient_treatments`);
  const extracted = await uploadScan(filePath, "ok");
  assert.equal(extracted.status, 201, JSON.stringify(extracted.body));
  assert.equal(extracted.body.job.status, "extracted");
  assert.match(String(extracted.body.job.extractedPayload?.patient?.fullName || ""), /Maria Santos/i);
  assert.equal(extracted.body.job.extractedPayload?.procedure?.visits?.[0]?.toothNos, "14");
  assert.equal(extracted.body.job.extractedPayload?.procedure?.notes || "", "");
  assert.match(String(extracted.body.job.rawText || ""), /TOOTH NO\.\s*14/i);
  const patientsAfterExtract = await db.query(`SELECT COUNT(*)::int AS count FROM clinic_patient_records`);
  const treatmentsAfterExtract = await db.query(`SELECT COUNT(*)::int AS count FROM clinic_patient_treatments`);
  assert.equal(patientsAfterExtract.rows[0].count, patientsBefore.rows[0].count);
  assert.equal(treatmentsAfterExtract.rows[0].count, treatmentsBefore.rows[0].count);

  const jobId = extracted.body.job.id;
  const payload = extracted.body.job.editedPayload;
  payload.patient.fullName = "Maria Santos";
  payload.patient.firstName = "Maria";
  payload.patient.lastName = "Santos";
  payload.procedure.treatment = "Oral Prophylaxis";
  payload.procedure.treatmentDate = "2024-09-07";
  payload.procedure.notes = HANDWRITING_TEXT.replace(/\n/g, " ");
  payload.procedure.visits = [
    {
      treatment: "Oral Prophylaxis",
      treatmentDate: "2024-09-07",
      toothNos: "14",
      amountCharged: "800",
    },
  ];
  const saved = await fetch(`${base}/api/admin/sync/documents/${jobId}/commit`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      origin: "http://127.0.0.1:5173",
    },
    body: JSON.stringify({
      payload,
      confirmNewPatient: true,
      branchId,
    }),
  });
  const savedBody = await saved.json();
  assert.equal(saved.status, 200, JSON.stringify(savedBody));
  const storedPatient = await db.query(
    `SELECT first_name, last_name FROM clinic_patient_records WHERE LOWER(last_name) = 'santos'`
  );
  assert.equal(storedPatient.rows.length, 1);
  assert.equal(storedPatient.rows[0].first_name, "Maria");
  const recordId = (
    await db.query(`SELECT id FROM clinic_patient_records WHERE LOWER(last_name) = 'santos' LIMIT 1`)
  ).rows[0].id;
  const rows = await db.query(
    `SELECT id, treatment, tooth_number, notes, diagnosis_notes
     FROM clinic_patient_treatments WHERE clinical_record_id = $1`,
    [recordId]
  );
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0].treatment, "Oral Prophylaxis");
  assert.equal(rows.rows[0].tooth_number, "14");
  assert.doesNotMatch(String(rows.rows[0].notes || ""), /AMOUNT CHARGED|TOOTH NO/i);
  assert.doesNotMatch(String(rows.rows[0].diagnosis_notes || ""), /AMOUNT CHARGED|TOOTH NO/i);

  const retry = await fetch(`${base}/api/admin/sync/documents/${jobId}/commit`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      origin: "http://127.0.0.1:5173",
    },
    body: JSON.stringify({
      payload,
      selectedPatientId: String(recordId),
      branchId,
    }),
  });
  assert.equal(retry.status, 409);
  const afterRetry = await db.query(
    `SELECT COUNT(*)::int AS count FROM clinic_patient_treatments WHERE clinical_record_id = $1`,
    [recordId]
  );
  assert.equal(afterRetry.rows[0].count, 1);

  const failed = await uploadScan(filePath, "fail");
  assert.equal(failed.status, 201, JSON.stringify(failed.body));
  assert.equal(failed.body.allowManualEntry, true);
  assert.equal(failed.body.ocrError, DOCUMENT_AI_PROCESSOR_MESSAGE);
  assert.equal(failed.body.ocrErrorCode, "processor_error");
  assert.equal(failed.body.job.status, "extracted");
  const failPayload = failed.body.job.editedPayload || {};
  failPayload.patient = {
    ...(failPayload.patient || {}),
    fullName: "Manual Chart",
    firstName: "Manual",
    lastName: "Chart",
  };
  failPayload.procedure = {
    ...(failPayload.procedure || {}),
    treatment: "Consultation",
    treatmentDate: "2024-09-08",
    visits: [{ treatment: "Consultation", treatmentDate: "2024-09-08", amountCharged: "500" }],
  };
  const manualSave = await fetch(`${base}/api/admin/sync/documents/${failed.body.job.id}/commit`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      origin: "http://127.0.0.1:5173",
    },
    body: JSON.stringify({
      payload: failPayload,
      confirmNewPatient: true,
      branchId,
    }),
  });
  const manualBody = await manualSave.json();
  assert.equal(manualSave.status, 200, JSON.stringify(manualBody));
  const manualPatient = await db.query(
    `SELECT id FROM clinic_patient_records WHERE LOWER(last_name) = 'chart'`
  );
  assert.equal(manualPatient.rows.length, 1);
});
