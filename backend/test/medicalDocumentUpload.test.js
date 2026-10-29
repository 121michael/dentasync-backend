"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const express = require("express");
const { createPatientPortalRouter } = require("../routes/patientPortal");
const { createDentistPortalRouter } = require("../routes/dentistPortal");
const medicalDocuments = require("../services/medicalDocuments");

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49,
  0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x01, 0x18, 0xdd, 0x8d, 0xb4,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);
const JPEG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
  0x00, 0xff, 0xd9,
]);
const PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

function dentistAccountRow() {
  return {
    id: "dentist-1",
    first_name: "Sarah",
    last_name: "Cruz",
    email: "dentist@example.test",
    phone: "639173333333",
    role: "dentist",
    status: "Active",
    is_verified: true,
    created_at: "2026-01-01T00:00:00.000Z",
    specialization: "Orthodontics",
    schedule_notes: "Mon–Fri",
    catalog_dentist_id: "dr-sarah-cruz",
  };
}

function clinicalRecordRow(overrides = {}) {
  return {
    id: 11,
    record_code: "CPR-TEST",
    first_name: "Test",
    last_name: "Patient",
    email: "patient@amethyst.com",
    phone: "639172222222",
    date_of_birth: "1990-01-01",
    gender: "female",
    address: "",
    notes: "",
    linked_user_id: "patient-1",
    patient_id: "P-1",
    is_archived: false,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
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

async function startPatientPortal({ userId = "patient-1", role = "patient", documents = [] } = {}) {
  const uploadDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "dentasync-medical-"));
  const store = { documents, appointments: [] };
  const app = express();
  app.use(express.json());
  app.use(
    "/api/patient",
    createPatientPortalRouter({
      db: {
        async query(sql, params = []) {
          if (sql.includes("FROM admin_portal_settings") || sql.includes("FROM clinic_schedule")) {
            const missing = new Error("missing");
            missing.code = "42P01";
            throw missing;
          }
          if (sql.includes("INSERT INTO patient_portal_documents")) {
            const [id, user_id, document_type, original_name, stored_name, mime_type, byte_size, category, status] =
              params;
            const row = {
              id,
              user_id,
              document_type,
              original_name,
              stored_name,
              mime_type,
              byte_size,
              category: category || null,
              status: status || "uploaded",
              appointment_id: null,
              created_at: new Date().toISOString(),
            };
            store.documents.push(row);
            return { rows: [row] };
          }
          if (sql.includes("FROM patient_portal_documents") && sql.includes("document_type = $3")) {
            const [id, owner, type] = params;
            return {
              rows: store.documents.filter(
                (row) => row.id === id && String(row.user_id) === String(owner) && row.document_type === type
              ),
            };
          }
          if (sql.includes("DELETE FROM patient_portal_documents")) {
            const [id, owner, type] = params;
            store.documents = store.documents.filter(
              (row) => !(row.id === id && String(row.user_id) === String(owner) && row.document_type === type)
            );
            return { rows: [] };
          }
          if (sql.includes("UPDATE patient_portal_documents") && sql.includes("appointment_id")) {
            const [appointmentId, documentId, owner, type] = params;
            const row = store.documents.find(
              (item) =>
                item.id === documentId && String(item.user_id) === String(owner) && item.document_type === type
            );
            if (row) row.appointment_id = appointmentId;
            return { rows: row ? [row] : [] };
          }
          if (sql.includes("INSERT INTO patient_portal_appointments")) {
            const row = {
              id: 88,
              user_id: params[0],
              service_id: params[1],
              service_name: params[2],
              dentist_id: params[3],
              dentist_name: params[4],
              appointment_date: params[5],
              appointment_time: params[6],
              coverage_type: params[7],
              status: "pending",
            };
            store.appointments.push(row);
            return { rows: [row] };
          }
          if (sql.includes("FROM patient_portal_appointments")) {
            return { rows: [] };
          }
          if (sql.includes("INSERT INTO patient_portal_notifications")) {
            return { rows: [] };
          }
          if (sql.includes("FROM users")) {
            return { rows: [{ full_name: "Test Patient", id: userId }] };
          }
          return { rows: [] };
        },
      },
      authenticateToken(req, _res, next) {
        req.user = { id: userId, role };
        next();
      },
      uploadDirectory,
    })
  );
  const server = await listen(app);
  return {
    url: `${server.url}/api/patient`,
    uploadDirectory,
    store,
    async close() {
      await server.close();
      fs.rmSync(uploadDirectory, { recursive: true, force: true });
    },
  };
}

async function startDentistPortal({
  tokenRole = "dentist",
  databaseRole = "dentist",
  linkedUserId = "patient-1",
  documents = [],
  uploadDirectory,
} = {}) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/dentist",
    createDentistPortalRouter({
      db: {
        async query(sql, params = []) {
          if (sql.includes("FROM users AS account") && sql.includes("LOWER(account.role) = 'dentist'")) {
            if (databaseRole !== "dentist") return { rows: [] };
            return { rows: [dentistAccountRow()] };
          }
          if (sql.includes("FROM clinic_patient_records AS record")) {
            if (Number(params[0]) !== 11) return { rows: [] };
            return { rows: [clinicalRecordRow({ linked_user_id: linkedUserId })] };
          }
          if (sql.includes("FROM clinic_patient_treatments")) {
            return { rows: [] };
          }
          if (sql.includes("FROM users AS account") && sql.includes("patient_portal_profiles")) {
            return {
              rows: [
                {
                  user_id: linkedUserId,
                  first_name: "Test",
                  last_name: "Patient",
                  email: "patient@amethyst.com",
                  phone: "639172222222",
                },
              ],
            };
          }
          if (sql.includes("FROM patient_portal_documents AS document")) {
            return {
              rows: documents.filter(
                (row) => String(row.user_id) === String(params[0]) && row.document_type === params[1]
              ),
            };
          }
          if (sql.includes("FROM patient_portal_documents") && sql.includes("stored_name")) {
            return {
              rows: documents.filter(
                (row) =>
                  row.id === params[0] &&
                  String(row.user_id) === String(params[1]) &&
                  row.document_type === params[2]
              ),
            };
          }
          if (sql.includes("UPDATE patient_portal_documents")) {
            const row = documents.find(
              (item) =>
                item.id === params[2] &&
                String(item.user_id) === String(params[3]) &&
                item.document_type === params[4]
            );
            if (!row) return { rows: [] };
            row.status = "reviewed";
            row.reviewed_by = params[0];
            row.reviewed_by_name = params[1];
            row.reviewed_at = new Date().toISOString();
            return { rows: [row] };
          }
          throw new Error(`Unexpected dentist query: ${sql}`);
        },
      },
      authenticateToken(req, _res, next) {
        req.user = { id: "dentist-1", role: tokenRole };
        next();
      },
      uploadDirectory,
    })
  );
  const server = await listen(app);
  return {
    url: `${server.url}/api/dentist`,
    close: server.close,
  };
}

async function postFile(url, { name, type, bytes, category = "medical_clearance", description } = {}) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), name);
  if (category) form.append("category", category);
  if (description) form.append("description", description);
  return fetch(url, { method: "POST", body: form });
}

test("validateMedicalUpload accepts PDF JPEG and PNG and rejects spoofed files", () => {
  const pdfPath = path.join(os.tmpdir(), `medical-${Date.now()}.pdf`);
  fs.writeFileSync(pdfPath, PDF_BYTES);
  medicalDocuments.validateMedicalUpload({
    originalname: "clearance.pdf",
    mimetype: "application/pdf",
    size: PDF_BYTES.length,
    path: pdfPath,
  });
  fs.unlinkSync(pdfPath);

  medicalDocuments.validateMedicalUpload({
    originalname: "scan.jpg",
    mimetype: "image/jpeg",
    size: JPEG_BYTES.length,
    buffer: JPEG_BYTES,
  });
  medicalDocuments.validateMedicalUpload({
    originalname: "scan.png",
    mimetype: "image/png",
    size: PNG_BYTES.length,
    buffer: PNG_BYTES,
  });

  assert.throws(
    () =>
      medicalDocuments.validateMedicalUpload({
        originalname: "clearance.pdf",
        mimetype: "application/pdf",
        size: 12,
        buffer: Buffer.from("<script>alert(1)</script>"),
      }),
    /not a valid PDF/
  );
  assert.throws(
    () =>
      medicalDocuments.validateMedicalUpload({
        originalname: "../secret.exe",
        mimetype: "application/pdf",
        size: PDF_BYTES.length,
        buffer: PDF_BYTES,
      }),
    /not valid/
  );
  assert.throws(
    () =>
      medicalDocuments.validateMedicalUpload({
        originalname: "huge.pdf",
        mimetype: "application/pdf",
        size: medicalDocuments.MAX_UPLOAD_BYTES + 1,
        buffer: PDF_BYTES,
      }),
    /5 MB/
  );
});

test("resolveStoredPath never leaves the upload directory", () => {
  const root = path.resolve("/tmp/dentasync-docs");
  assert.equal(medicalDocuments.resolveStoredPath(root, "../etc/passwd"), path.join(root, "passwd"));
  assert.equal(medicalDocuments.resolveStoredPath(root, "ok.pdf"), path.join(root, "ok.pdf"));
});

test("patient medical upload stores the file under a generated name", async () => {
  const portal = await startPatientPortal();
  try {
    const response = await postFile(`${portal.url}/uploads/medical-document`, {
      name: "physician-clearance.pdf",
      type: "application/pdf",
      bytes: PDF_BYTES,
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.match(body.message, /saved for your dentist/i);
    assert.equal(body.document.name, "Medical Clearance / Authorization");
    assert.equal(body.document.filename, "physician-clearance.pdf");
    assert.equal(body.document.status, "uploaded");
    assert.equal(body.document.category, "Medical Clearance / Authorization");
    assert.equal(portal.store.documents.length, 1);
    assert.equal(portal.store.documents[0].user_id, "patient-1");
    assert.equal(portal.store.documents[0].document_type, "medical_document");
    assert.notEqual(portal.store.documents[0].stored_name, "physician-clearance.pdf");
    const storedPath = path.join(portal.uploadDirectory, portal.store.documents[0].stored_name);
    assert.equal(fs.existsSync(storedPath), true);
    assert.equal(fs.readFileSync(storedPath).subarray(0, 5).toString(), "%PDF-");
  } finally {
    await portal.close();
  }
});

test("patient medical upload requires a document type", async () => {
  const portal = await startPatientPortal();
  try {
    const response = await postFile(`${portal.url}/uploads/medical-document`, {
      name: "physician-clearance.pdf",
      type: "application/pdf",
      bytes: PDF_BYTES,
      category: "",
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /document type/i);
    assert.equal(portal.store.documents.length, 0);
  } finally {
    await portal.close();
  }
});

test("patient medical upload accepts JPEG and PNG", async () => {
  const portal = await startPatientPortal();
  try {
    const jpeg = await postFile(`${portal.url}/uploads/medical-document`, {
      name: "clearance.jpg",
      type: "image/jpeg",
      bytes: JPEG_BYTES,
    });
    assert.equal(jpeg.status, 201);
    const png = await postFile(`${portal.url}/uploads/medical-document`, {
      name: "clearance.png",
      type: "image/png",
      bytes: PNG_BYTES,
    });
    assert.equal(png.status, 201);
  } finally {
    await portal.close();
  }
});

test("patient medical upload rejects unsupported and tampered files", async () => {
  const portal = await startPatientPortal();
  try {
    const exe = await postFile(`${portal.url}/uploads/medical-document`, {
      name: "payload.exe",
      type: "application/octet-stream",
      bytes: Buffer.from("MZ"),
    });
    assert.equal(exe.status, 400);

    const spoofed = await postFile(`${portal.url}/uploads/medical-document`, {
      name: "clearance.pdf",
      type: "application/pdf",
      bytes: Buffer.from("<html><script>alert(1)</script></html>"),
    });
    assert.equal(spoofed.status, 400);
    assert.match((await spoofed.json()).message, /not a valid PDF/);
    assert.equal(portal.store.documents.length, 0);
  } finally {
    await portal.close();
  }
});

test("patient medical upload rejects oversized files", async () => {
  const portal = await startPatientPortal();
  try {
    const oversized = Buffer.alloc(medicalDocuments.MAX_UPLOAD_BYTES + 16, 0x41);
    oversized.set(Buffer.from("%PDF-1.4"), 0);
    const response = await postFile(`${portal.url}/uploads/medical-document`, {
      name: "huge.pdf",
      type: "application/pdf",
      bytes: oversized,
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /5 MB/i);
  } finally {
    await portal.close();
  }
});

test("booking without a medical document still creates the appointment", async () => {
  const portal = await startPatientPortal();
  try {
    const response = await fetch(`${portal.url}/appointments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serviceId: "cleaning",
        appointmentDate: "2099-12-15",
        appointmentTime: "09:00",
        coverageType: "self_pay",
      }),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.appointment.treatment, "Dental Cleaning / Oral Prophylaxis");
    assert.equal(portal.store.appointments.length, 1);
  } finally {
    await portal.close();
  }
});

test("booking links an owned medical document to the appointment", async () => {
  const portal = await startPatientPortal();
  try {
    const upload = await postFile(`${portal.url}/uploads/medical-document`, {
      name: "clearance.pdf",
      type: "application/pdf",
      bytes: PDF_BYTES,
    });
    const document = (await upload.json()).document;
    const response = await fetch(`${portal.url}/appointments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serviceId: "extraction",
        appointmentDate: "2099-12-16",
        appointmentTime: "10:00",
        coverageType: "self_pay",
        medicalDocumentId: document.id,
      }),
    });
    assert.equal(response.status, 201);
    assert.equal(portal.store.documents[0].appointment_id, 88);
    assert.equal(portal.store.documents[0].user_id, "patient-1");
  } finally {
    await portal.close();
  }
});

test("patient medical upload stores the description the dentist will see", async () => {
  const portal = await startPatientPortal();
  try {
    const response = await postFile(`${portal.url}/uploads/medical-document`, {
      name: "scan.pdf",
      type: "application/pdf",
      bytes: PDF_BYTES,
      category: "medical_clearance",
      description: "Medical Clearance",
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.document.name, "Medical Clearance");
    assert.equal(body.document.filename, "scan.pdf");
    assert.equal(portal.store.documents[0].category, "Medical Clearance");
    assert.equal(portal.store.documents[0].user_id, "patient-1");
  } finally {
    await portal.close();
  }
});

test("booking rejects another patient's medical document id", async () => {
  const portal = await startPatientPortal();
  try {
    const response = await fetch(`${portal.url}/appointments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serviceId: "cleaning",
        appointmentDate: "2099-12-17",
        appointmentTime: "11:00",
        coverageType: "self_pay",
        medicalDocumentId: "someone-elses-doc",
      }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /not available/);
  } finally {
    await portal.close();
  }
});

test("non-patient accounts cannot upload medical documents", async () => {
  const portal = await startPatientPortal({ role: "staff" });
  try {
    const response = await postFile(`${portal.url}/uploads/medical-document`, {
      name: "clearance.pdf",
      type: "application/pdf",
      bytes: PDF_BYTES,
    });
    assert.equal(response.status, 403);
  } finally {
    await portal.close();
  }
});

test("dentist can list and download a linked patient's medical document", async () => {
  const uploadDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "dentasync-dentist-docs-"));
  const storedName = "stored-clearance.pdf";
  fs.writeFileSync(path.join(uploadDirectory, storedName), PDF_BYTES);
  const documents = [
    {
      id: "doc-1",
      user_id: "patient-1",
      document_type: "medical_document",
      original_name: "physician-clearance.pdf",
      stored_name: storedName,
      mime_type: "application/pdf",
      byte_size: PDF_BYTES.length,
      category: "Medical clearance / supporting document",
      status: "uploaded",
      created_at: "2026-10-29T02:00:00.000Z",
      appointment_id: 88,
      service_name: "Tooth Extraction",
      appointment_date: "2099-12-16",
      appointment_time: "10:00",
    },
  ];
  const portal = await startDentistPortal({ documents, uploadDirectory });
  try {
    const list = await fetch(`${portal.url}/patients/11/medical-documents`);
    assert.equal(list.status, 200);
    const body = await list.json();
    assert.equal(body.documents.length, 1);
    assert.equal(body.documents[0].name, "Uncategorized");
    assert.equal(body.documents[0].filename, "physician-clearance.pdf");
    assert.equal(body.documents[0].category, "Uncategorized");
    assert.equal(body.documents[0].appointment.service, "Tooth Extraction");
    assert.match(body.disclaimer, /does not automatically grant medical clearance/i);

    const download = await fetch(`${portal.url}/patients/11/medical-documents/doc-1/download`);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("x-content-type-options"), "nosniff");
    assert.match(download.headers.get("content-disposition") || "", /attachment/);
    assert.equal(Buffer.from(await download.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");

    const preview = await fetch(`${portal.url}/patients/11/medical-documents/doc-1/download?inline=1`);
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get("content-disposition") || "", /inline/);
    assert.match(preview.headers.get("content-type") || "", /pdf/i);

    const reviewed = await fetch(`${portal.url}/patients/11/medical-documents/doc-1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "reviewed" }),
    });
    assert.equal(reviewed.status, 200);
    const reviewedBody = await reviewed.json();
    assert.equal(reviewedBody.document.status, "reviewed");
    assert.match(reviewedBody.message, /does not automatically grant/i);
  } finally {
    await portal.close();
    fs.rmSync(uploadDirectory, { recursive: true, force: true });
  }
});

test("dentist medical document list uses the patient description as the document name", async () => {
  const portal = await startDentistPortal({
    documents: [
      {
        id: "doc-clearance",
        user_id: "patient-1",
        document_type: "medical_document",
        original_name: "scan-room-2.pdf",
        stored_name: "hidden.pdf",
        mime_type: "application/pdf",
        byte_size: 12,
        category: "Medical Clearance",
        status: "uploaded",
        created_at: "2026-10-29T03:00:00.000Z",
        appointment_id: 91,
        service_name: "Tooth Extraction",
        appointment_date: "2099-12-18",
        appointment_time: "14:00",
      },
      {
        id: "doc-other",
        user_id: "someone-else",
        document_type: "medical_document",
        original_name: "other.pdf",
        stored_name: "other.pdf",
        mime_type: "application/pdf",
        byte_size: 12,
        category: "Secret File",
        status: "uploaded",
        created_at: "2026-10-29T03:00:00.000Z",
      },
    ],
  });
  try {
    const list = await fetch(`${portal.url}/patients/11/medical-documents`);
    assert.equal(list.status, 200);
    const body = await list.json();
    assert.equal(body.documents.length, 1);
    assert.equal(body.documents[0].name, "Medical Clearance");
    assert.equal(body.documents[0].filename, "scan-room-2.pdf");
    assert.equal(body.documents[0].appointment.service, "Tooth Extraction");
  } finally {
    await portal.close();
  }
});

test("mapMedicalDocument keeps known types and falls back to Uncategorized", () => {
  const xray = medicalDocuments.mapMedicalDocument({
    id: "a",
    original_name: "xray.png",
    category: "dental_xray",
    mime_type: "image/png",
    byte_size: 12,
    status: "uploaded",
    created_at: "2026-10-29T02:00:00.000Z",
  });
  assert.equal(xray.category, "Dental X-ray / Radiograph");
  assert.equal(xray.name, "Dental X-ray / Radiograph");
  assert.equal(xray.filename, "xray.png");
  const legacy = medicalDocuments.mapMedicalDocument({
    id: "b",
    original_name: "old.pdf",
    category: "Medical clearance / supporting document",
    mime_type: "application/pdf",
    byte_size: 12,
    status: "uploaded",
    created_at: "2026-10-29T02:00:00.000Z",
  });
  assert.equal(legacy.category, "Uncategorized");
  assert.equal(legacy.name, "Uncategorized");
  assert.equal(legacy.filename, "old.pdf");
  const described = medicalDocuments.mapMedicalDocument({
    id: "c",
    original_name: "scan.pdf",
    category: "Medical Clearance",
    mime_type: "application/pdf",
    byte_size: 12,
    status: "uploaded",
    created_at: "2026-10-29T02:00:00.000Z",
  });
  assert.equal(described.name, "Medical Clearance");
  assert.equal(described.filename, "scan.pdf");
  assert.equal(medicalDocuments.resolveDocumentType("Other Medical Document")?.id, "other");
  assert.equal(medicalDocuments.resolveDocumentType("other")?.label, "Other Dental Document");
});

test("dentist cannot download another patient's medical document by swapping ids", async () => {
  const uploadDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "dentasync-dentist-docs-"));
  fs.writeFileSync(path.join(uploadDirectory, "secret.pdf"), PDF_BYTES);
  const documents = [
    {
      id: "secret-doc",
      user_id: "other-patient",
      document_type: "medical_document",
      original_name: "secret.pdf",
      stored_name: "secret.pdf",
      mime_type: "application/pdf",
      byte_size: PDF_BYTES.length,
    },
  ];
  const portal = await startDentistPortal({ documents, uploadDirectory, linkedUserId: "patient-1" });
  try {
    const download = await fetch(`${portal.url}/patients/11/medical-documents/secret-doc/download`);
    assert.equal(download.status, 404);
    const inlinePreview = await fetch(
      `${portal.url}/patients/11/medical-documents/secret-doc/download?inline=1`
    );
    assert.equal(inlinePreview.status, 404);
    const missingRecord = await fetch(`${portal.url}/patients/999/medical-documents/secret-doc/download`);
    assert.equal(missingRecord.status, 404);
  } finally {
    await portal.close();
    fs.rmSync(uploadDirectory, { recursive: true, force: true });
  }
});

test("staff tokens cannot access dentist medical document routes", async () => {
  const portal = await startDentistPortal({ tokenRole: "staff", databaseRole: "staff" });
  try {
    const response = await fetch(`${portal.url}/patients/11/medical-documents`);
    assert.equal(response.status, 403);
  } finally {
    await portal.close();
  }
});
