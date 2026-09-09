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
  normalizeAmount,
  DocumentValidationError,
  UNSUPPORTED_DOCUMENT_MESSAGE,
} = require("../services/documentSyncExtraction");
const clinicalPatients = require("../services/clinicalPatients");
const { writeAdminAudit } = require("../services/adminAudit");
const {
  discardTemporaryDocumentFile,
  temporaryDocumentExists,
  cleanupFinishedDocumentTemps,
  resolveTempDocumentPath,
} = require("../services/documentSyncTempStorage");

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/jpg",
]);

const ALLOWED_EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg"]);

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

function sourceLabel(sourceType, mimeType, originalName) {
  if (sourceType === "hard_copy_scan") return "Scan";
  const extension = path.extname(originalName || "").toLowerCase();
  if (mimeType === "application/pdf" || extension === ".pdf") return "PDF";
  if (mimeType === "image/png" || extension === ".png") return "PNG";
  if (mimeType === "image/jpeg" || mimeType === "image/jpg" || [".jpg", ".jpeg"].includes(extension)) {
    return "JPEG";
  }
  return "Document";
}

function auditActor(req) {
  const name =
    `${req.admin?.first_name || ""} ${req.admin?.last_name || ""}`.trim() ||
    req.admin?.email ||
    "Admin";
  return {
    actorId: req.admin?.id ? String(req.admin.id) : null,
    actorName: name,
    actorRole: "admin",
    ipAddress: req.ip || null,
    sessionId: null,
  };
}

function mapJob(row) {
  return {
    id: row.id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size || 0),
    sourceType: row.source_type,
    sourceLabel: sourceLabel(row.source_type, row.mime_type, row.original_name),
    status: row.status,
    rawText: "", // OCR dump is temporary server-side only; never shown in Admin UI
    extractedPayload: row.extracted_payload || emptyPayload(),
    editedPayload: row.edited_payload || emptyPayload(),
    extractionNotes: row.extraction_notes || "",
    linkedPatientId: row.linked_patient_id || null,
    linkedTreatmentId: row.linked_treatment_id || null,
    errorMessage: row.error_message || null,
    syncedAt: row.synced_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Preview is temporary only while Admin reviews; never after commit/reject.
    hasPreview:
      Boolean(row.stored_name) &&
      ["uploaded", "extracted", "reviewed"].includes(row.status),
    sourceDocumentRetained: false,
  };
}

function sanitizePayload(input) {
  const patient = input?.patient && typeof input.patient === "object" ? input.patient : {};
  const procedure = input?.procedure && typeof input.procedure === "object" ? input.procedure : {};

  let firstName = stringValue(patient.firstName, 80) || "";
  let lastName = stringValue(patient.lastName, 80) || "";
  const fullName =
    stringValue(patient.fullName, 160) || `${firstName} ${lastName}`.trim();

  if ((!firstName || !lastName) && fullName) {
    const parts = fullName.split(/\s+/).filter(Boolean);
    firstName = firstName || parts[0] || "";
    lastName = lastName || (parts.length > 1 ? parts.slice(1).join(" ") : "");
  }

  return {
    patient: {
      firstName,
      lastName,
      fullName: fullName || `${firstName} ${lastName}`.trim(),
      email: normalizeEmail(patient.email) || "",
      phone: normalizePhone(patient.phone || "") || stringValue(patient.phone, 40) || "",
      dateOfBirth: normalizeDate(patient.dateOfBirth || "") || "",
      age: stringValue(String(patient.age ?? ""), 3) || "",
      gender: stringValue(patient.gender, 40) || "",
      address: stringValue(patient.address, 300) || "",
    },
    procedure: {
      treatment: stringValue(procedure.treatment, 180) || "",
      dentistName: stringValue(procedure.dentistName, 120) || "",
      treatmentDate: normalizeDate(procedure.treatmentDate || "") || "",
      amountCharged: normalizeAmount(procedure.amountCharged || "") || "",
      clinicLocation: stringValue(procedure.clinicLocation, 180) || "Amethyst Dental Clinic",
      status: ["planned", "in_progress", "completed"].includes(String(procedure.status || "").toLowerCase())
        ? String(procedure.status).toLowerCase()
        : "completed",
      notes: stringValue(procedure.notes, 2000) || "",
      coverageStatus: stringValue(procedure.coverageStatus, 120) || "",
    },
  };
}

async function findMatchingClinicalPatient(client, patient) {
  if (patient.email || patient.phone) {
    const byContact = await client.query(
      `SELECT id, record_code, first_name, last_name, email, phone, date_of_birth
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
    if (byContact.rows.length) {
      return {
        record: byContact.rows[0],
        matchReason: patient.email && byContact.rows[0].email?.toLowerCase() === patient.email.toLowerCase()
          ? "email"
          : "phone",
      };
    }
  }

  if (patient.firstName && patient.lastName && patient.dateOfBirth) {
    const byIdentity = await client.query(
      `SELECT id, record_code, first_name, last_name, email, phone, date_of_birth
       FROM clinic_patient_records
       WHERE COALESCE(is_archived, FALSE) = FALSE
         AND LOWER(first_name) = LOWER($1)
         AND LOWER(last_name) = LOWER($2)
         AND date_of_birth = $3::date
       ORDER BY updated_at DESC
       LIMIT 1`,
      [patient.firstName, patient.lastName, patient.dateOfBirth]
    );
    if (byIdentity.rows.length) {
      return { record: byIdentity.rows[0], matchReason: "name_and_date_of_birth" };
    }
  }

  if (patient.fullName && patient.dateOfBirth) {
    const byFullName = await client.query(
      `SELECT id, record_code, first_name, last_name, email, phone, date_of_birth
       FROM clinic_patient_records
       WHERE COALESCE(is_archived, FALSE) = FALSE
         AND LOWER(TRIM(CONCAT(first_name, ' ', last_name))) = LOWER($1)
         AND date_of_birth = $2::date
       ORDER BY updated_at DESC
       LIMIT 1`,
      [patient.fullName, patient.dateOfBirth]
    );
    if (byFullName.rows.length) {
      return { record: byFullName.rows[0], matchReason: "full_name_and_date_of_birth" };
    }
  }

  return { record: null, matchReason: null };
}

function mapMatchRecord(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    recordCode: row.record_code || null,
    firstName: row.first_name || "",
    lastName: row.last_name || "",
    fullName: `${row.first_name || ""} ${row.last_name || ""}`.trim(),
    email: row.email || "",
    phone: row.phone || "",
    dateOfBirth: row.date_of_birth || null,
  };
}

function attachAdminDocumentSyncRoutes(router, { db, uploadDirectory }) {
  fs.mkdirSync(uploadDirectory, { recursive: true });
  // Best-effort cleanup of leftover temps from prior commits/rejects.
  cleanupFinishedDocumentTemps(db, uploadDirectory).catch(() => {});

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
      const extension = path.extname(file.originalname || "").toLowerCase();
      if (!ALLOWED_TYPES.has(file.mimetype) && !ALLOWED_EXTENSIONS.has(extension)) {
        return callback(new Error(UNSUPPORTED_DOCUMENT_MESSAGE));
      }
      if (ALLOWED_EXTENSIONS.size && extension && !ALLOWED_EXTENSIONS.has(extension)) {
        return callback(new Error(UNSUPPORTED_DOCUMENT_MESSAGE));
      }
      callback(null, true);
    },
  });

  router.get("/sync/documents", async (_req, res) => {
    try {
      await cleanupFinishedDocumentTemps(db, uploadDirectory);
      const result = await db.query(
        `SELECT *
         FROM admin_portal_document_sync_jobs
         ORDER BY created_at DESC
         LIMIT 40`
      );
      return res.json({
        jobs: result.rows.map((row) => {
          const job = mapJob(row);
          job.hasPreview =
            job.hasPreview && temporaryDocumentExists(uploadDirectory, row.stored_name);
          return job;
        }),
      });
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
      const row = result.rows[0];
      const job = mapJob(row);
      job.hasPreview =
        job.hasPreview && temporaryDocumentExists(uploadDirectory, row.stored_name);
      return res.json({ job });
    } catch (error) {
      console.error("Document sync detail error:", error.message);
      return res.status(500).json({ message: "Unable to load the document sync job." });
    }
  });

  router.get("/sync/documents/:id/file", async (req, res) => {
    try {
      const result = await db.query(
        `SELECT stored_name, mime_type, original_name, status
         FROM admin_portal_document_sync_jobs
         WHERE id = $1
         LIMIT 1`,
        [req.params.id]
      );
      if (!result.rows.length) {
        return res.status(404).json({ message: "Document sync job not found." });
      }
      const job = result.rows[0];
      if (!["uploaded", "extracted", "reviewed"].includes(job.status) || !job.stored_name) {
        return res.status(410).json({
          message:
            "The source document was discarded after processing. Only extracted structured data is retained.",
        });
      }
      const filePath = resolveTempDocumentPath(uploadDirectory, job.stored_name);
      if (!filePath || !fs.existsSync(filePath)) {
        return res.status(404).json({
          message: "Temporary document preview is no longer available.",
        });
      }
      res.setHeader("Content-Type", job.mime_type || "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${String(job.original_name || "document").replace(/"/g, "")}"`
      );
      return res.sendFile(filePath);
    } catch (error) {
      console.error("Document preview error:", error.message);
      return res.status(500).json({ message: "Unable to load document preview." });
    }
  });

  router.post("/sync/documents", (req, res) => {
    upload.single("document")(req, res, async (uploadError) => {
      if (uploadError) {
        await writeAdminAudit(db, {
          ...auditActor(req),
          action: "Document Data Import",
          targetType: "document_sync",
          result: "failed",
          detail: `Rejected upload: ${uploadError.message}`,
        });
        return res.status(400).json({ message: uploadError.message });
      }
      if (!req.file) {
        return res.status(400).json({ message: "Choose a document to scan or upload." });
      }
      if (!req.file.size) {
        fs.unlink(req.file.path, () => {});
        await writeAdminAudit(db, {
          ...auditActor(req),
          action: "Document Data Import",
          targetType: "document_sync",
          result: "failed",
          detail: "Rejected empty/blank file.",
        });
        return res.status(400).json({ message: UNSUPPORTED_DOCUMENT_MESSAGE });
      }

      const sourceType =
        stringValue(req.body?.sourceType, 40) === "hard_copy_scan"
          ? "hard_copy_scan"
          : "soft_copy";
      const label = sourceLabel(sourceType, req.file.mimetype, req.file.originalname);

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
          [extraction.rawText, JSON.stringify(extraction.payload), extraction.extractionNotes, jobId]
        );

        await writeAdminAudit(db, {
          ...auditActor(req),
          action: "Document Data Import",
          targetType: "document_sync",
          targetId: String(jobId),
          targetLabel: req.file.originalname,
          result: "success",
          detail: `Source: ${label}. Extracted fields for admin review. Source document is temporary and will be discarded after confirm or reject.`,
        });

        const filled = Number(extraction.autoFilledCount || 0);
        return res.status(201).json({
          message:
            filled > 0
              ? `Document detected — auto-filled ${filled} field${filled === 1 ? "" : "s"}. Review them, then Confirm & Save.`
              : "Document detected. Enter readable fields from the preview, then Confirm & Save.",
          job: mapJob(updated.rows[0]),
          fieldStatuses: extraction.fieldStatuses || {},
          autoFilledCount: filled,
        });
      } catch (error) {
        const isValidation =
          error instanceof DocumentValidationError || error?.code === "INVALID_DOCUMENT";
        const storedName = req.file?.filename || null;
        if (jobId) {
          await db
            .query(
              `UPDATE admin_portal_document_sync_jobs
               SET status = 'failed',
                   error_message = $1,
                   stored_name = NULL,
                   raw_text = NULL,
                   byte_size = 0,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = $2`,
              [error.message, jobId]
            )
            .catch(() => {});
        }

        // Always discard the temporary source on failure — never keep rejected files.
        if (req.file?.path) {
          fs.unlink(req.file.path, () => {});
        } else if (storedName) {
          discardTemporaryDocumentFile(uploadDirectory, storedName);
        }

        await writeAdminAudit(db, {
          ...auditActor(req),
          action: "Document Data Import",
          targetType: "document_sync",
          targetId: jobId ? String(jobId) : null,
          targetLabel: req.file?.originalname || null,
          result: "failed",
          detail: `Source: ${label}. ${error.message}. Temporary source document discarded.`,
        });

        if (error.code === "42P01") {
          return res.status(503).json({
            message: "Document sync tables are not available. Run npm run migrate:document-sync.",
          });
        }
        console.error("Document scan error:", error.message);
        return res.status(isValidation ? 400 : 500).json({
          message: error.message || "Unable to scan and extract document data.",
          code: isValidation ? "INVALID_DOCUMENT" : undefined,
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

  router.post("/sync/documents/:id/match-preview", async (req, res) => {
    try {
      const jobResult = await db.query(
        `SELECT * FROM admin_portal_document_sync_jobs WHERE id = $1 LIMIT 1`,
        [req.params.id]
      );
      if (!jobResult.rows.length) {
        return res.status(404).json({ message: "Document sync job not found." });
      }
      const payload = sanitizePayload(req.body?.payload || jobResult.rows[0].edited_payload);
      const match = await findMatchingClinicalPatient(db, payload.patient);
      return res.json({
        match: mapMatchRecord(match.record),
        matchReason: match.matchReason,
        isNewPatient: !match.record,
        proposedPatient: {
          fullName: payload.patient.fullName,
          dateOfBirth: payload.patient.dateOfBirth || null,
          age: payload.patient.age || null,
          phone: payload.patient.phone || null,
        },
      });
    } catch (error) {
      console.error("Document match preview error:", error.message);
      return res.status(500).json({ message: "Unable to preview patient match." });
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
        return res.status(409).json({ message: "This document was already imported to the database." });
      }
      if (job.status === "failed") {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return res.status(400).json({
          message: "This document was rejected and cannot be saved to the patient database.",
        });
      }

      const payload = sanitizePayload(req.body?.payload || job.edited_payload || job.extracted_payload);
      const patient = payload.patient;
      const procedure = payload.procedure;
      const confirmNewPatient = Boolean(req.body?.confirmNewPatient);
      const label = sourceLabel(job.source_type, job.mime_type, job.original_name);

      if (!patient.firstName || !patient.lastName) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return res.status(400).json({
          message: "Patient full name is required before saving. Correct the extracted fields first.",
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
      if (procedure.treatment && !procedure.treatmentDate) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return res.status(400).json({
          message:
            "Treatment date is required when a procedure is present. Use the date from the document, not today's booking date.",
        });
      }

      const match = await findMatchingClinicalPatient(client, patient);
      let clinicalRecordId = match.record ? match.record.id : null;
      let createdNewPatient = false;

      if (!clinicalRecordId && !confirmNewPatient) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return res.status(409).json({
          message: "New patient record detected. Review the proposed patient information and confirm to create it.",
          needsNewPatientConfirmation: true,
          proposedPatient: {
            fullName: patient.fullName,
            dateOfBirth: patient.dateOfBirth || null,
            age: patient.age || null,
            phone: patient.phone || null,
            email: patient.email || null,
          },
        });
      }

      if (clinicalRecordId) {
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
      } else {
        const notesParts = ["Imported via Admin Document Data Extraction"];
        if (patient.age) notesParts.push(`Age at import: ${patient.age}`);
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
            notes: notesParts.join(". "),
          },
          { id: req.admin.id, role: "admin-sync" }
        );
        clinicalRecordId = created.id;
        createdNewPatient = true;
      }

      let treatment = null;
      if (procedure.treatment) {
        const treatmentNotes = [
          procedure.notes || null,
          "Imported via Admin Document Data Extraction",
          patient.age ? `Patient age on document: ${patient.age}` : null,
        ]
          .filter(Boolean)
          .join(". ");

        treatment = await clinicalPatients.addClinicalTreatment(
          client,
          clinicalRecordId,
          {
            treatment: procedure.treatment,
            dentistName: procedure.dentistName,
            clinicLocation: procedure.clinicLocation || "Amethyst Dental Clinic",
            coverageStatus: procedure.coverageStatus,
            status: procedure.status || "completed",
            treatmentDate: procedure.treatmentDate,
            amountCharged: procedure.amountCharged || 0,
            notes: treatmentNotes,
          },
          { id: req.admin.id, role: "admin-sync" }
        );
      }

      const tempStoredName = job.stored_name;

      await client.query(
        `UPDATE admin_portal_document_sync_jobs
         SET status = 'synced',
             edited_payload = $1::jsonb,
             linked_patient_id = $2,
             linked_treatment_id = $3,
             synced_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP,
             error_message = NULL,
             stored_name = NULL,
             raw_text = NULL,
             byte_size = 0
         WHERE id = $4`,
        [
          JSON.stringify(payload),
          String(clinicalRecordId),
          treatment?.id || null,
          job.id,
        ]
      );

      await client.query(
        `INSERT INTO admin_portal_sync_events (
           triggered_by, status, database_ok, api_ok, email_ok, detail
         ) VALUES ($1, 'success', TRUE, TRUE, TRUE, $2)`,
        [
          String(req.admin.id),
          `Document import saved for ${patient.firstName} ${patient.lastName}${
            procedure.treatment ? ` (${procedure.treatment})` : ""
          }. Source document discarded.`,
        ]
      );

      await client.query("COMMIT");
      transactionOpen = false;

      // Delete temporary source after structured data is committed.
      discardTemporaryDocumentFile(uploadDirectory, tempStoredName);

      await writeAdminAudit(db, {
        ...auditActor(req),
        action: "Document Data Import",
        targetType: "clinical_patient",
        targetId: String(clinicalRecordId),
        targetLabel: patient.fullName,
        result: "success",
        detail: [
          `Source: ${label}`,
          `Result: Successful`,
          `Patient: ${clinicalRecordId}`,
          createdNewPatient ? "Created new patient record" : "Updated existing patient record",
          treatment?.id ? `Treatment: ${treatment.id}` : "No treatment row (patient info only)",
          match.matchReason ? `Match: ${match.matchReason}` : null,
          "Temporary source document deleted; only structured data retained",
        ]
          .filter(Boolean)
          .join(". "),
      });

      const refreshed = await db.query(
        `SELECT * FROM admin_portal_document_sync_jobs WHERE id = $1`,
        [job.id]
      );

      return res.json({
        message:
          "Document successfully imported and data saved. The original source document was deleted.",
        job: mapJob(refreshed.rows[0]),
        linked: {
          clinicalRecordId: String(clinicalRecordId),
          treatmentId: treatment?.id || null,
          createdNewPatient,
          matchReason: match.matchReason,
        },
      });
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK");
      }
      await writeAdminAudit(db, {
        ...auditActor(req),
        action: "Document Data Import",
        targetType: "document_sync",
        targetId: req.params.id ? String(req.params.id) : null,
        result: "failed",
        detail: error.message || "Unable to save document data.",
      });
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
