"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const {
  emptyPayload,
  extractDocumentData,
  normalizePhone,
  normalizeDate,
} = require("../services/documentSyncExtraction");
const clinicalPatients = require("../services/clinicalPatients");

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/csv",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/bmp",
  "image/tiff",
]);

function stringValue(value, maxLength = 500) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeEmail(value) {
  const email = stringValue(value, 254)?.toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function mapJob(row) {
  return {
    id: row.id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size || 0),
    sourceType: row.source_type,
    status: row.status,
    rawText: row.raw_text || "",
    extractedPayload: row.extracted_payload || emptyPayload(),
    editedPayload: row.edited_payload || emptyPayload(),
    extractionNotes: row.extraction_notes || "",
    linkedPatientId: row.linked_patient_id || null,
    linkedTreatmentId: row.linked_treatment_id || null,
    errorMessage: row.error_message || null,
    syncedAt: row.synced_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sanitizePayload(input) {
  const base = emptyPayload();
  const patient = input?.patient && typeof input.patient === "object" ? input.patient : {};
  const procedure = input?.procedure && typeof input.procedure === "object" ? input.procedure : {};

  const firstName = stringValue(patient.firstName, 80) || "";
  const lastName = stringValue(patient.lastName, 80) || "";
  const fullName =
    stringValue(patient.fullName, 160) ||
    `${firstName} ${lastName}`.trim();

  return {
    patient: {
      firstName,
      lastName,
      fullName,
      email: normalizeEmail(patient.email) || "",
      phone: normalizePhone(patient.phone || "") || stringValue(patient.phone, 40) || "",
      dateOfBirth: normalizeDate(patient.dateOfBirth || "") || "",
      gender: stringValue(patient.gender, 40) || "",
      address: stringValue(patient.address, 300) || "",
    },
    procedure: {
      treatment: stringValue(procedure.treatment, 180) || "",
      dentistName: stringValue(procedure.dentistName, 120) || "",
      treatmentDate: normalizeDate(procedure.treatmentDate || "") || "",
      clinicLocation: stringValue(procedure.clinicLocation, 180) || "Amethyst Dental Clinic",
      status: ["planned", "in_progress", "completed"].includes(String(procedure.status || "").toLowerCase())
        ? String(procedure.status).toLowerCase()
        : "completed",
      notes: stringValue(procedure.notes, 2000) || "",
      coverageStatus: stringValue(procedure.coverageStatus, 120) || "",
    },
  };
}

function attachAdminDocumentSyncRoutes(router, { db, uploadDirectory }) {
  fs.mkdirSync(uploadDirectory, { recursive: true });

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, callback) => callback(null, uploadDirectory),
      filename: (_req, file, callback) => {
        const extension = path.extname(file.originalname).toLowerCase() || ".bin";
        callback(null, `${crypto.randomUUID()}${extension}`);
      },
    }),
    limits: { fileSize: 12 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, callback) => {
      if (!ALLOWED_TYPES.has(file.mimetype)) {
        return callback(new Error("Upload a PDF, TXT, JPG, or PNG dental document."));
      }
      callback(null, true);
    },
  });

  router.get("/sync/documents", async (_req, res) => {
    try {
      const result = await db.query(
        `SELECT *
         FROM admin_portal_document_sync_jobs
         ORDER BY created_at DESC
         LIMIT 40`
      );
      return res.json({ jobs: result.rows.map(mapJob) });
    } catch (error) {
      if (error.code === "42P01") {
        return res.status(503).json({
          message: "Document sync tables are not available. Run npm run migrate:document-sync.",
        });
      }
      console.error("Document sync list error:", error.message);
      return res.status(500).json({ message: "Unable to load document sync jobs." });
    }
  });

  router.get("/sync/documents/:id", async (req, res) => {
    try {
      const result = await db.query(
        `SELECT * FROM admin_portal_document_sync_jobs WHERE id = $1 LIMIT 1`,
        [req.params.id]
      );
      if (!result.rows.length) {
        return res.status(404).json({ message: "Document sync job not found." });
      }
      return res.json({ job: mapJob(result.rows[0]) });
    } catch (error) {
      console.error("Document sync detail error:", error.message);
      return res.status(500).json({ message: "Unable to load the document sync job." });
    }
  });

  router.post("/sync/documents", (req, res) => {
    upload.single("document")(req, res, async (uploadError) => {
      if (uploadError) {
        return res.status(400).json({ message: uploadError.message });
      }
      if (!req.file) {
        return res.status(400).json({ message: "Choose a document to scan or upload." });
      }

      const sourceType =
        stringValue(req.body?.sourceType, 40) === "hard_copy_scan"
          ? "hard_copy_scan"
          : "soft_copy";

      let jobId = null;
      try {
        const inserted = await db.query(
          `INSERT INTO admin_portal_document_sync_jobs (
             uploaded_by, original_name, stored_name, mime_type, byte_size, source_type, status
           ) VALUES ($1, $2, $3, $4, $5, $6, 'uploaded')
           RETURNING id`,
          [
            String(req.admin.id),
            req.file.originalname,
            req.file.filename,
            req.file.mimetype,
            req.file.size,
            sourceType,
          ]
        );
        jobId = inserted.rows[0].id;

        const extraction = await extractDocumentData(
          req.file.path,
          req.file.mimetype,
          req.file.originalname
        );

        const updated = await db.query(
          `UPDATE admin_portal_document_sync_jobs
           SET status = 'extracted',
               raw_text = $1,
               extracted_payload = $2::jsonb,
               edited_payload = $2::jsonb,
               extraction_notes = $3,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $4
           RETURNING *`,
          [
            extraction.rawText,
            JSON.stringify(extraction.payload),
            extraction.extractionNotes,
            jobId,
          ]
        );

        return res.status(201).json({
          message: "Document scanned and important fields extracted. Please review before syncing.",
          job: mapJob(updated.rows[0]),
        });
      } catch (error) {
        if (jobId) {
          await db.query(
            `UPDATE admin_portal_document_sync_jobs
             SET status = 'failed',
                 error_message = $1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [error.message, jobId]
          ).catch(() => {});
        }
        if (error.code === "42P01") {
          return res.status(503).json({
            message: "Document sync tables are not available. Run npm run migrate:document-sync.",
          });
        }
        console.error("Document scan error:", error.message);
        return res.status(500).json({
          message: error.message || "Unable to scan and extract document data.",
        });
      }
    });
  });

  router.put("/sync/documents/:id", async (req, res) => {
    const payload = sanitizePayload(req.body?.payload || req.body);
    try {
      const result = await db.query(
        `UPDATE admin_portal_document_sync_jobs
         SET edited_payload = $1::jsonb,
             status = CASE WHEN status = 'synced' THEN status ELSE 'reviewed' END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING *`,
        [JSON.stringify(payload), req.params.id]
      );
      if (!result.rows.length) {
        return res.status(404).json({ message: "Document sync job not found." });
      }
      return res.json({
        message: "Reviewed data saved.",
        job: mapJob(result.rows[0]),
      });
    } catch (error) {
      console.error("Document sync edit error:", error.message);
      return res.status(500).json({ message: "Unable to save reviewed document data." });
    }
  });

  router.post("/sync/documents/:id/commit", async (req, res) => {
    const client = await db.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;

      const jobResult = await client.query(
        `SELECT * FROM admin_portal_document_sync_jobs WHERE id = $1 FOR UPDATE`,
        [req.params.id]
      );
      const job = jobResult.rows[0];
      if (!job) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return res.status(404).json({ message: "Document sync job not found." });
      }
      if (job.status === "synced") {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return res.status(409).json({ message: "This document was already synced to the database." });
      }

      const payload = sanitizePayload(req.body?.payload || job.edited_payload || job.extracted_payload);
      const patient = payload.patient;
      const procedure = payload.procedure;

      if (!patient.firstName || !patient.lastName) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return res.status(400).json({
          message: "Patient first name and last name are required before syncing.",
        });
      }
      if (!procedure.treatment) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return res.status(400).json({
          message: "Dental procedure / treatment is required before syncing.",
        });
      }
      if (patient.dateOfBirth && !isIsoDate(patient.dateOfBirth)) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return res.status(400).json({ message: "Provide a valid patient date of birth (YYYY-MM-DD)." });
      }
      if (procedure.treatmentDate && !isIsoDate(procedure.treatmentDate)) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return res.status(400).json({ message: "Provide a valid treatment date (YYYY-MM-DD)." });
      }

      let clinicalRecordId = null;
      if (patient.email || patient.phone) {
        const existing = await client.query(
          `SELECT id
           FROM clinic_patient_records
           WHERE COALESCE(is_archived, FALSE) = FALSE
             AND (
               ($1::text IS NOT NULL AND LOWER(email) = LOWER($1))
               OR ($2::text IS NOT NULL AND phone = $2)
             )
           ORDER BY updated_at DESC
           LIMIT 1`,
          [patient.email || null, patient.phone || null]
        );
        if (existing.rows.length) {
          clinicalRecordId = existing.rows[0].id;
          await clinicalPatients.updateClinicalRecord(
            client,
            clinicalRecordId,
            {
              firstName: patient.firstName,
              lastName: patient.lastName,
              email: patient.email,
              phone: patient.phone,
              dateOfBirth: patient.dateOfBirth,
              gender: patient.gender,
              address: patient.address,
            },
            { id: req.admin.id, role: "admin-sync" }
          );
        }
      }

      if (!clinicalRecordId) {
        const created = await clinicalPatients.createClinicalRecord(
          client,
          {
            firstName: patient.firstName,
            lastName: patient.lastName,
            email: patient.email,
            phone: patient.phone,
            dateOfBirth: patient.dateOfBirth,
            gender: patient.gender,
            address: patient.address,
            notes: `Synced from document: ${job.original_name}`,
          },
          { id: req.admin.id, role: "admin-sync" }
        );
        clinicalRecordId = created.id;
      }

      const treatment = await clinicalPatients.addClinicalTreatment(
        client,
        clinicalRecordId,
        {
          treatment: procedure.treatment,
          dentistName: procedure.dentistName,
          clinicLocation: procedure.clinicLocation || "Amethyst Dental Clinic",
          coverageStatus: procedure.coverageStatus,
          status: procedure.status || "completed",
          treatmentDate: procedure.treatmentDate || new Date().toISOString().slice(0, 10),
          notes: procedure.notes || `Synced from document: ${job.original_name}`,
        },
        { id: req.admin.id, role: "admin-sync" }
      );

      await client.query(
        `UPDATE admin_portal_document_sync_jobs
         SET status = 'synced',
             edited_payload = $1::jsonb,
             linked_patient_id = $2,
             linked_treatment_id = $3,
             synced_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP,
             error_message = NULL
         WHERE id = $4`,
        [
          JSON.stringify(payload),
          String(clinicalRecordId),
          treatment.id,
          job.id,
        ]
      );

      await client.query(
        `INSERT INTO admin_portal_sync_events (
           triggered_by, status, database_ok, api_ok, email_ok, detail
         ) VALUES ($1, 'success', TRUE, TRUE, TRUE, $2)`,
        [
          String(req.admin.id),
          `Document sync committed clinical record for ${patient.firstName} ${patient.lastName} (${procedure.treatment}).`,
        ]
      );

      await client.query("COMMIT");
      transactionOpen = false;

      const refreshed = await db.query(
        `SELECT * FROM admin_portal_document_sync_jobs WHERE id = $1`,
        [job.id]
      );

      return res.json({
        message: "Document data synced as a clinical patient record (not a login account).",
        job: mapJob(refreshed.rows[0]),
        linked: {
          clinicalRecordId: String(clinicalRecordId),
          treatmentId: treatment.id,
        },
      });
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK");
      }
      console.error("Document sync commit error:", error.message);
      return res.status(error.status || 500).json({
        message: error.message || "Unable to sync document data to the database.",
      });
    } finally {
      client.release();
    }
  });
}

module.exports = {
  attachAdminDocumentSyncRoutes,
};
