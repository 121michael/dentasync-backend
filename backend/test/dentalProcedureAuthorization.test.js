"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const express = require("express");
const {
  validateAuthorizationUpload,
  statusAfterUpload,
  canRecordSignature,
  mapRow,
  createAuthorization,
  recordSignature,
  saveUpload,
  replaceWithNewVersion,
  assertVisibleTo,
  TEMPLATE_TEXT,
} = require("../services/dentalProcedureAuthorization");
const { renderAuthorizationPdf } = require("../services/dentalAuthorizationPdf");
const { attachDentalAuthorizationRoutes } = require("../routes/dentalAuthorization");
const { createAdminPortalRouter } = require("../routes/adminPortal");

test("unsigned uploads never become signed", () => {
  assert.equal(
    statusAfterUpload({ currentStatus: "draft", signedCopyConfirmed: false, actorRole: "admin" }),
    "draft"
  );
  assert.equal(
    statusAfterUpload({
      currentStatus: "awaiting_signature",
      signedCopyConfirmed: false,
      actorRole: "dentist",
    }),
    "awaiting_signature"
  );
});

test("only dentist or admin may confirm a signed copy on upload", () => {
  assert.equal(canRecordSignature("staff"), false);
  assert.throws(
    () =>
      statusAfterUpload({
        currentStatus: "awaiting_signature",
        signedCopyConfirmed: true,
        actorRole: "staff",
      }),
    /dentist or administrator/i
  );
  assert.equal(
    statusAfterUpload({
      currentStatus: "awaiting_signature",
      signedCopyConfirmed: true,
      actorRole: "dentist",
    }),
    "signed"
  );
});

test("upload validation rejects invalid types, empty files, and oversized payloads", () => {
  assert.throws(
    () => validateAuthorizationUpload({ mimeType: "application/zip", byteSize: 12, originalName: "x.zip" }),
    /PDF, JPG, and PNG/i
  );
  assert.throws(
    () => validateAuthorizationUpload({ mimeType: "application/pdf", byteSize: 0, originalName: "x.pdf" }),
    /empty/i
  );
  assert.throws(
    () =>
      validateAuthorizationUpload({
        mimeType: "application/pdf",
        byteSize: 6 * 1024 * 1024,
        originalName: "x.pdf",
      }),
    /5 MB/i
  );
  assert.throws(
    () =>
      validateAuthorizationUpload({
        mimeType: "application/pdf",
        byteSize: 4,
        originalName: "../secret.pdf",
      }),
    /file name/i
  );
  assert.throws(
    () =>
      validateAuthorizationUpload({
        mimeType: "application/pdf",
        byteSize: 8,
        originalName: "fake.pdf",
        buffer: Buffer.from("not-a-pdf"),
      }),
    /not a valid PDF/i
  );
  validateAuthorizationUpload({
    mimeType: "application/pdf",
    byteSize: 8,
    originalName: "ok.pdf",
    buffer: Buffer.from("%PDF-1.4"),
  });
});

test("patients cannot read another patient's authorization by id", () => {
  const row = { linked_user_id: "patient-a" };
  assert.throws(() => assertVisibleTo("patient", "patient-b", row), /not found/i);
  assert.doesNotThrow(() => assertVisibleTo("patient", "patient-a", row));
});

test("generated documents start as draft with general consent wording", async () => {
  const rows = [];
  const db = {
    async query(sql, params = []) {
      if (sql.includes("FROM clinic_patient_records")) {
        return {
          rows: [
            {
              id: 11,
              record_code: "CPR-TEST",
              first_name: "Ana",
              last_name: "Reyes",
              phone: "09170000000",
              date_of_birth: "1990-05-01",
              linked_user_id: "patient-1",
              patient_id: "ADC-2601-0001",
              age: 36,
            },
          ],
        };
      }
      if (sql.includes("SELECT document_number")) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO dental_procedure_authorizations")) {
        const row = {
          id: params[0],
          document_number: params[1],
          clinical_record_id: params[2],
          linked_user_id: params[3],
          appointment_id: params[4],
          treatment_id: params[5],
          version: 1,
          status: "draft",
          patient_full_name: params[6],
          patient_clinic_id: params[7],
          patient_date_of_birth: params[8],
          patient_age: params[9],
          patient_phone: params[10],
          procedure_name: params[11],
          tooth_or_area: params[12],
          treating_dentist: params[13],
          planned_procedure_date: params[14],
          clinical_notes: params[15],
          explanation: params[16],
          expected_benefits: params[17],
          material_risks: params[18],
          alternatives: params[19],
          questions_opportunity: params[20],
          voluntary_authorization: params[21],
          withdrawal_statement: params[22],
          understanding_confirmation: params[23],
          dentist_name: params[24],
          witness_name: params[25],
          guardian_name: params[26],
          created_by: params[27],
          created_by_role: params[28],
          created_at: "2026-10-29T00:00:00.000Z",
          updated_at: "2026-10-29T00:00:00.000Z",
        };
        rows.push(row);
        return { rows: [row] };
      }
      if (sql.includes("INSERT INTO admin_portal_audit_logs")) {
        return { rows: [{ id: 1 }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const document = await createAuthorization(db, {
    clinicalRecordId: 11,
    body: { procedureName: "Permanent Filling / Restoration", toothOrArea: "36" },
    actor: { id: "dentist-1", first_name: "Sarah", last_name: "Cruz" },
    role: "dentist",
  });

  assert.equal(document.status, "draft");
  assert.equal(document.procedureName, "Permanent Filling / Restoration");
  assert.equal(document.patientClinicId, "ADC-2601-0001");
  assert.match(document.documentNumber, /^ADC-AUTH-\d{4}-\d{4}$/);
  assert.match(document.materialRisks, /does not list every possible risk/i);
  assert.equal(document.explanation, TEMPLATE_TEXT.explanation);
  assert.equal(rows[0].status, "draft");
});

test("recording a signature requires a signer name and dentist/admin role", async () => {
  const row = {
    id: "auth-1",
    status: "awaiting_signature",
    dentist_name: "Dr. Cruz",
    treating_dentist: "Dr. Cruz",
    document_number: "ADC-AUTH-2026-0001",
  };
  const db = {
    async query(sql, params) {
      if (sql.includes("SELECT * FROM dental_procedure_authorizations")) {
        return { rows: [row] };
      }
      if (sql.includes("SET status = 'signed'")) {
        return {
          rows: [
            {
              ...row,
              status: "signed",
              patient_or_representative_name: params[1],
              consent_recorded_by_role: params[9],
            },
          ],
        };
      }
      if (sql.includes("admin_portal_audit_logs")) return { rows: [{}] };
      throw new Error(sql);
    },
  };

  await assert.rejects(
    () => recordSignature(db, { id: "auth-1", actor: { id: "s1" }, role: "staff", body: { patientOrRepresentativeName: "Ana" } }),
    /dentist or administrator/i
  );
  await assert.rejects(
    () => recordSignature(db, { id: "auth-1", actor: { id: "d1" }, role: "dentist", body: {} }),
    /name of the patient/i
  );
  const signed = await recordSignature(db, {
    id: "auth-1",
    actor: { id: "d1", first_name: "Sarah", last_name: "Cruz" },
    role: "dentist",
    body: { patientOrRepresentativeName: "Ana Reyes" },
  });
  assert.equal(signed.status, "signed");
});

test("replacing an authorization keeps the prior row as superseded", async () => {
  const original = {
    id: "auth-old",
    document_number: "ADC-AUTH-2026-0001",
    clinical_record_id: 11,
    linked_user_id: "patient-1",
    version: 1,
    status: "signed",
    patient_full_name: "Ana Reyes",
    patient_clinic_id: "ADC-2601-0001",
    procedure_name: "Filling",
    explanation: TEMPLATE_TEXT.explanation,
    expected_benefits: TEMPLATE_TEXT.expectedBenefits,
    material_risks: TEMPLATE_TEXT.materialRisks,
    alternatives: TEMPLATE_TEXT.alternatives,
    questions_opportunity: TEMPLATE_TEXT.questionsOpportunity,
    voluntary_authorization: TEMPLATE_TEXT.voluntaryAuthorization,
    withdrawal_statement: TEMPLATE_TEXT.withdrawalStatement,
    understanding_confirmation: TEMPLATE_TEXT.understandingConfirmation,
  };
  const updates = [];
  const db = {
    async query(sql, params) {
      if (sql.includes("SELECT * FROM dental_procedure_authorizations")) return { rows: [original] };
      if (sql.includes("FROM clinic_patient_records")) {
        return {
          rows: [
            {
              id: 11,
              record_code: "CPR-TEST",
              first_name: "Ana",
              last_name: "Reyes",
              patient_id: "ADC-2601-0001",
              linked_user_id: "patient-1",
            },
          ],
        };
      }
      if (sql.includes("SELECT document_number")) return { rows: [{ document_number: "ADC-AUTH-2026-0001" }] };
      if (sql.includes("INSERT INTO dental_procedure_authorizations")) {
        return {
          rows: [
            {
              id: params[0],
              document_number: params[1],
              version: params[6],
              status: "draft",
              supersedes_id: params[7],
              procedure_name: params[13],
              clinical_record_id: 11,
            },
          ],
        };
      }
      if (sql.includes("SET status = 'superseded'")) {
        updates.push({ id: params[0], supersededBy: params[1] });
        return { rows: [] };
      }
      if (sql.includes("admin_portal_audit_logs")) return { rows: [{}] };
      throw new Error(sql);
    },
  };

  const next = await replaceWithNewVersion(db, {
    id: "auth-old",
    actor: { id: "admin-1" },
    role: "admin",
    body: {},
  });
  assert.equal(next.status, "draft");
  assert.equal(next.version, 2);
  assert.equal(updates[0].id, "auth-old");
  assert.equal(updates[0].supersededBy, next.id);
});

test("PDF output is an A4 document with clinic title and consent sections", async () => {
  const pdf = await renderAuthorizationPdf({
    clinic: {
      name: "Amethyst Dental Clinic",
      address: "Makati, Metro Manila",
      phone: "+63 2 8555 1234",
      email: "care@amethystdental.example",
    },
    document: mapRow({
      document_number: "ADC-AUTH-2026-0001",
      status: "draft",
      version: 1,
      patient_full_name: "Test Patient",
      patient_clinic_id: "ADC-2601-0099",
      procedure_name: "Dental Cleaning / Oral Prophylaxis",
      treating_dentist: "Clinic dentist",
      explanation: TEMPLATE_TEXT.explanation,
      expected_benefits: TEMPLATE_TEXT.expectedBenefits,
      material_risks: TEMPLATE_TEXT.materialRisks,
      alternatives: TEMPLATE_TEXT.alternatives,
      questions_opportunity: TEMPLATE_TEXT.questionsOpportunity,
      voluntary_authorization: TEMPLATE_TEXT.voluntaryAuthorization,
      withdrawal_statement: TEMPLATE_TEXT.withdrawalStatement,
      understanding_confirmation: TEMPLATE_TEXT.understandingConfirmation,
    }),
  });
  const pdfText = pdf.toString("latin1");
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.match(pdfText, /Authorization and Informed Consent for Dental Procedure/);
  assert.match(pdfText, /Amethyst Dental Clinic/);
  assert.match(pdfText, /MediaBox \[0 0 595\.28 841\.89\]/);
  assert.match(pdfText, /\/Count [1-9]/);
});

test("admin authorization routes reject a non-admin database role", async () => {
  const app = express();
  app.use(
    "/api/admin",
    createAdminPortalRouter({
      db: {
        async query(sql) {
          if (sql.includes("FROM users") && sql.includes("LOWER(role) = 'admin'")) {
            return { rows: [] };
          }
          throw new Error(sql);
        },
      },
      emailDeliveryIsConfigured: () => false,
      authenticateToken(req, _res, next) {
        req.user = { id: "staff-1", role: "admin" };
        next();
      },
    })
  );
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/admin/clinical-records/11/authorizations`;
    const response = await fetch(url);
    assert.equal(response.status, 403);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("patient authorization download is scoped to the linked user", async () => {
  const app = express();
  const router = express.Router();
  router.use((req, _res, next) => {
    req.user = { id: "patient-b", role: "patient" };
    next();
  });
  attachDentalAuthorizationRoutes(router, {
    db: {
      async query(sql) {
        if (sql.includes("SELECT * FROM dental_procedure_authorizations")) {
          return {
            rows: [
              {
                id: "auth-1",
                document_number: "ADC-AUTH-2026-0001",
                clinical_record_id: 11,
                linked_user_id: "patient-a",
                status: "draft",
                version: 1,
                patient_full_name: "Other Patient",
                procedure_name: "Filling",
                explanation: "x",
                expected_benefits: "x",
                material_risks: "x",
                alternatives: "x",
                questions_opportunity: "x",
                voluntary_authorization: "x",
                withdrawal_statement: "x",
                understanding_confirmation: "x",
              },
            ],
          };
        }
        throw new Error(sql);
      },
    },
    role: "patient",
    uploadDirectory: fs.mkdtempSync(path.join(os.tmpdir(), "auth-up-")),
  });
  app.use("/api/patient", router);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/patient/authorizations/auth-1/pdf`
    );
    assert.equal(response.status, 404);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("upload of an unsigned PDF keeps draft status", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "auth-store-"));
  const uploadPath = path.join(tmp, "sample.pdf");
  fs.writeFileSync(uploadPath, "%PDF-1.4 test");
  const row = {
    id: "auth-1",
    status: "draft",
    document_number: "ADC-AUTH-2026-0001",
    stored_name: null,
  };
  const db = {
    async query(sql, params) {
      if (sql.includes("SELECT * FROM dental_procedure_authorizations")) return { rows: [row] };
      if (sql.includes("UPDATE dental_procedure_authorizations")) {
        return {
          rows: [
            {
              ...row,
              original_name: params[1],
              stored_name: params[2],
              mime_type: params[3],
              byte_size: params[4],
              upload_contains_signature: params[7],
              status: params[8],
            },
          ],
        };
      }
      if (sql.includes("admin_portal_audit_logs")) return { rows: [{}] };
      throw new Error(sql);
    },
  };
  const saved = await saveUpload(db, {
    id: "auth-1",
    actor: { id: "staff-1" },
    role: "staff",
    file: {
      originalname: "unsigned.pdf",
      mimetype: "application/pdf",
      size: fs.statSync(uploadPath).size,
      path: uploadPath,
    },
    signedCopyConfirmed: false,
    uploadDirectory: tmp,
  });
  assert.equal(saved.status, "draft");
  assert.equal(saved.uploadContainsSignature, false);
});
