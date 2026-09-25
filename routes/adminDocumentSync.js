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
  toIsoDocumentDate,
  normalizeAmount,
  DocumentValidationError,
  UNSUPPORTED_DOCUMENT_MESSAGE,
} = require("../services/documentSyncExtraction");
const clinicalPatients = require("../services/clinicalPatients");
const patientData = require("../services/patientData");
const { writeAdminAudit } = require("../services/adminAudit");
const {
  findMatchingClinicalPatients,
  findPatientConflicts,
  inferPatientCategory,
} = require("../services/documentSyncPatientMatch");
const {
  discardTemporaryDocumentFile,
  temporaryDocumentExists,
  cleanupFinishedDocumentTemps,
  resolveTempDocumentPath,
} = require("../services/documentSyncTempStorage");

const MAX_VISIT_ROWS = 500;

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

function extractedPatientName(payload) {
  const patient = payload?.patient || {};
  return String(patient.fullName || `${patient.firstName || ""} ${patient.lastName || ""}`).trim();
}

function mapJob(row) {
  const extracted = row.extracted_payload || emptyPayload();
  const edited = row.edited_payload || emptyPayload();
  const expiresAt = row.expires_at || null;
  const expired = Boolean(expiresAt && new Date(expiresAt).getTime() <= Date.now());
  const previewable =
    Boolean(row.stored_name) &&
    !expired &&
    ["uploaded", "extracted", "reviewed"].includes(row.status);
  return {
    id: row.id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size || 0),
    sourceType: row.source_type,
    sourceLabel: sourceLabel(row.source_type, row.mime_type, row.original_name),
    status: row.status,
    rawText: "",
    extractedPayload: extracted,
    editedPayload: edited,
    extractionNotes: row.extraction_notes || "",
    linkedPatientId: row.linked_patient_id || null,
    linkedTreatmentId: row.linked_treatment_id || null,
    errorMessage: row.error_message || null,
    syncedAt: row.synced_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    uploadedAt: row.created_at,
    expiresAt,
    expired,
    extractedName: extractedPatientName(edited) || extractedPatientName(extracted),
    needsReview: Boolean(extracted?.documentQuality?.needsReview),
    hasPreview: previewable,
    sourceDocumentRetained: previewable,
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
  if (firstName && !lastName) {
    lastName = firstName;
  }

  const allowedSex = new Set(["Male", "Female", "Non-binary", "Prefer to self-describe"]);
  const gender = allowedSex.has(patientData.normalizeSex(patient.gender))
    ? patientData.normalizeSex(patient.gender)
    : "";

  return {
    documentForm:
      input?.documentForm === "treatment_record" ||
      (Array.isArray(procedure.visits) && procedure.visits.length > 0 && /treatment|tooth/i.test(JSON.stringify(procedure.visits)))
        ? "treatment_record"
        : stringValue(input?.documentForm, 40) || "generic",
    documentQuality:
      input?.documentQuality && typeof input.documentQuality === "object"
        ? {
            needsReview: Boolean(input.documentQuality.needsReview),
            reason: stringValue(input.documentQuality.reason, 80) || "",
          }
        : undefined,
    patient: {
      firstName,
      lastName,
      fullName: fullName || `${firstName} ${lastName}`.trim(),
      email: normalizeEmail(patient.email) || "",
      phone: normalizePhone(patient.phone || "") || "",
      dateOfBirth: toIsoDocumentDate(patient.dateOfBirth || "") || "",
      age: stringValue(String(patient.age ?? ""), 3) || "",
      gender,
      address: stringValue(patient.address, 300) || "",
    },
    procedure: {
      treatment: stringValue(procedure.treatment, 180) || "",
      dentistName: stringValue(procedure.dentistName, 120) || "",
      treatmentDate:
        normalizeDate(procedure.treatmentDate || "") ||
        stringValue(procedure.treatmentDate, 40) ||
        "",
      amountCharged:
        stringValue(String(procedure.amountCharged ?? ""), 40) ||
        normalizeAmount(procedure.amountCharged || "") ||
        "",
      clinicLocation: stringValue(procedure.clinicLocation, 180) || "Amethyst Dental Clinic",
      status: ["planned", "in_progress", "completed"].includes(String(procedure.status || "").toLowerCase())
        ? String(procedure.status).toLowerCase()
        : "completed",
      notes: stringValue(procedure.notes, 2000) || "",
      coverageStatus: stringValue(procedure.coverageStatus, 120) || "",
      visits: Array.isArray(procedure.visits)
        ? procedure.visits.slice(0, MAX_VISIT_ROWS).map((row) => ({
            treatmentDate: stringValue(row?.treatmentDate || row?.date || "", 40) || "",
            toothNos: stringValue(row?.toothNos || row?.toothNumber || "", 40) || "",
            treatment: stringValue(row?.treatment || row?.procedure || "", 180) || "",
            dentistName: stringValue(row?.dentistName || row?.dentist || "", 120) || "",
            amountCharged: stringValue(String(row?.amountCharged ?? row?.amount ?? ""), 40) || "",
            amountPaid: stringValue(String(row?.amountPaid ?? ""), 40) || "",
            balance: stringValue(String(row?.balance ?? ""), 40) || "",
            nextAppt: stringValue(row?.nextAppt || row?.nextAppointment || "", 40) || "",
          }))
        : [],
    },
  };
}

async function loadClinicalRecord(client, recordId) {
  if (!recordId) return null;
  try {
    const result = await client.query(
      `SELECT id, record_code, patient_id, first_name, last_name, email, phone, date_of_birth, address
       FROM clinic_patient_records
       WHERE id::text = $1
         AND COALESCE(is_archived, FALSE) = FALSE
       LIMIT 1`,
      [String(recordId)]
    );
    return result.rows[0] || null;
  } catch {
    return null;
  }
}

function mapMatchRecord(candidate) {
  if (!candidate) return null;
  return {
    id: String(candidate.id),
    recordCode: candidate.recordCode || candidate.record_code || null,
    patientId: candidate.patientId || candidate.patient_id || candidate.recordCode || null,
    firstName: candidate.firstName || candidate.first_name || "",
    lastName: candidate.lastName || candidate.last_name || "",
    fullName:
      candidate.fullName ||
      `${candidate.firstName || candidate.first_name || ""} ${candidate.lastName || candidate.last_name || ""}`.trim(),
    email: candidate.email || "",
    phone: candidate.phone || "",
    dateOfBirth: candidate.dateOfBirth || candidate.date_of_birth || null,
    matchReason: candidate.matchReason || null,
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
         WHERE stored_name IS NOT NULL
           AND status IN ('uploaded', 'extracted', 'reviewed')
         ORDER BY created_at DESC
         LIMIT 40`
      );
      return res.json({
        jobs: result.rows
          .map((row) => {
            const job = mapJob(row);
            job.hasPreview =
              job.hasPreview && temporaryDocumentExists(uploadDirectory, row.stored_name);
            return job;
          })
          .filter((job) => !job.expired),
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
        `SELECT stored_name, mime_type, original_name, status, expires_at
         FROM admin_portal_document_sync_jobs
         WHERE id = $1
         LIMIT 1`,
        [req.params.id]
      );
      if (!result.rows.length) {
        return res.status(404).json({ message: "Document sync job not found." });
      }
      const job = result.rows[0];
      if (job.expires_at && new Date(job.expires_at).getTime() <= Date.now()) {
        return res.status(410).json({
          message: "Document no longer available. This temporary scan expired after 24 hours.",
          code: "SCAN_EXPIRED",
        });
      }
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
        let inserted;
        try {
          inserted = await db.query(
            `INSERT INTO admin_portal_document_sync_jobs (
               uploaded_by, original_name, stored_name, mime_type, byte_size, source_type, status, expires_at
             ) VALUES ($1, $2, $3, $4, $5, $6, 'uploaded', CURRENT_TIMESTAMP + INTERVAL '24 hours')
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
        } catch (insertError) {
          if (insertError.code !== "42703") throw insertError;
          inserted = await db.query(
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
        }
        jobId = inserted.rows[0].id;

        const extraction = await extractDocumentData(
          req.file.path,
          req.file.mimetype,
          req.file.originalname
        );

        const storedPayload = {
          ...extraction.payload,
          documentQuality: {
            needsReview: Boolean(extraction.needsReview),
            reason: extraction.validation?.reason || "",
          },
        };
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
          [extraction.rawText, JSON.stringify(storedPayload), extraction.extractionNotes, jobId]
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
        if (filled <= 0) {
          throw new DocumentValidationError(
            "Unable to read the uploaded or scanned document. No patient or treatment fields could be detected. Please upload a clearer scan or photo and try again."
          );
        }
        const buildTag =
          (String(extraction.extractionNotes || "").match(/autofill-build:\s*[\w.-]+/i) || [])[0] ||
          "autofill-build: treatment-zone-v7";
        return res.status(201).json({
          message: extraction.needsReview
            ? `Document Needs Review. We found text, but we could not confidently identify this as a patient or dental record. (${buildTag})`
            : `Document read successfully — populated ${filled} field${filled === 1 ? "" : "s"} to match the scan. Review them, then Confirm & Save. (${buildTag})`,
          job: mapJob(updated.rows[0]),
          fieldStatuses: extraction.fieldStatuses || {},
          autoFilledCount: filled,
          extractionNotes: extraction.extractionNotes || "",
          needsReview: Boolean(extraction.needsReview),
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
    try {
      const payload = sanitizePayload(req.body?.payload || req.body);
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
      const found = await findMatchingClinicalPatients(db, payload.patient);
      const matches = found.candidates.map(mapMatchRecord);
      const single = matches.length === 1 ? matches[0] : null;
      return res.json({
        matches,
        match: single,
        matchReason: found.matchReason,
        isNewPatient: matches.length === 0,
        needsSelection: matches.length > 1,
        needsMergeDecision: matches.length === 1,
        conflicts: single ? findPatientConflicts(payload.patient, single) : [],
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
      const selectedPatientId = stringValue(req.body?.selectedPatientId, 80);
      const fieldResolutions =
        req.body?.fieldResolutions && typeof req.body.fieldResolutions === "object"
          ? req.body.fieldResolutions
          : {};
      const manualFields =
        req.body?.manualFields && typeof req.body.manualFields === "object" ? req.body.manualFields : {};
      const label = sourceLabel(job.source_type, job.mime_type, job.original_name);

      if (!patient.firstName || !patient.lastName) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return res.status(400).json({
          message:
            "Patient name is required before saving. Enter the Name from the document (or type it if the line was blank), then try again.",
        });
      }
      const dateOfBirthIso = toIsoDocumentDate(patient.dateOfBirth);
      if (patient.dateOfBirth && !dateOfBirthIso) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return res.status(400).json({
          message:
            "Date of Birth must be a real calendar date. Leave it blank if the document did not include one.",
        });
      }
      patient.dateOfBirth = dateOfBirthIso;

      const recoveredDateIso =
        toIsoDocumentDate(procedure.treatmentDate) || toIsoDocumentDate(job.raw_text || "");
      const primaryDateIso = recoveredDateIso;
      const visitRows = Array.isArray(procedure.visits)
        ? procedure.visits
            .filter((row) => stringValue(row?.treatment, 180))
            .map((row) => ({
              ...row,
              treatmentDate: toIsoDocumentDate(row.treatmentDate) || recoveredDateIso,
              amountCharged: normalizeAmount(row.amountCharged) || String(row.amountCharged || "").replace(/(?:₱|php)/gi, "").trim(),
              amountPaid: normalizeAmount(row.amountPaid) || String(row.amountPaid || "").replace(/(?:₱|php)/gi, "").trim(),
            }))
        : [];
      const datedVisitRows = visitRows.filter((row) => isIsoDate(row.treatmentDate) || toIsoDocumentDate(row.treatmentDate));
      let skippedUndated = visitRows.length - datedVisitRows.length;
      const hasVisitTable = datedVisitRows.length > 0;

      if (hasVisitTable) {
        procedure.visits = datedVisitRows;
        if (!procedure.treatmentDate) procedure.treatmentDate = datedVisitRows[0].treatmentDate;
      }

      const found = await findMatchingClinicalPatients(client, patient);
      const matches = found.candidates.map(mapMatchRecord);
      let createdNewPatient = false;
      let matchReason = found.matchReason;
      let clinicalRecordId = null;
      let matchedRecord = null;

      if (confirmNewPatient) {
        clinicalRecordId = null;
        matchReason = null;
      } else if (selectedPatientId) {
        const chosen =
          matches.find((row) => String(row.id) === String(selectedPatientId)) ||
          mapMatchRecord(await loadClinicalRecord(client, selectedPatientId));
        if (!chosen) {
          await client.query("ROLLBACK");
          transactionOpen = false;
          return res.status(400).json({ message: "The selected patient could not be found." });
        }
        clinicalRecordId = chosen.id;
        matchReason = chosen.matchReason || "admin_selected";
        matchedRecord = await loadClinicalRecord(client, chosen.id);
      } else if (matches.length > 1) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return res.status(409).json({
          message: "More than one existing patient matches this name. Select the correct record or create a new patient.",
          needsSelection: true,
          matches,
        });
      } else if (matches.length === 1) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return res.status(409).json({
          message: "Possible existing patient found. Choose Merge With Existing Patient or Create New Patient.",
          needsMergeDecision: true,
          match: matches[0],
          matches,
          conflicts: findPatientConflicts(patient, matches[0]),
        });
      } else if (!confirmNewPatient) {
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

      if (!clinicalRecordId) {
        const notesParts = ["Imported via Admin Document Data Extraction"];
        if (patient.age) notesParts.push(`Age at import: ${patient.age}`);
        const created = await clinicalPatients.createClinicalRecord(
          client,
          {
            firstName: patient.firstName,
            lastName: patient.lastName,
            email: patient.email,
            phone: patient.phone,
            dateOfBirth:
              normalizeDate(patient.dateOfBirth) ||
              (isIsoDate(patient.dateOfBirth) ? patient.dateOfBirth : "") ||
              null,
            gender: patient.gender,
            address: patient.address,
            notes: notesParts.join(". "),
            patientCategory: inferPatientCategory(patient.age),
          },
          { id: req.admin.id, role: "admin-sync" }
        );
        clinicalRecordId = created.id;
        createdNewPatient = true;
      } else if (matchedRecord) {
        const conflicts = findPatientConflicts(patient, matchedRecord);
        const updates = {};
        for (const conflict of conflicts) {
          const choice = String(fieldResolutions[conflict.field] || "").toLowerCase();
          if (choice === "document" || choice === "use document") {
            if (conflict.field === "Phone") updates.phone = patient.phone;
            if (conflict.field === "Email") updates.email = patient.email;
            if (conflict.field === "Date of Birth") updates.dateOfBirth = patient.dateOfBirth;
            if (conflict.field === "Address") updates.address = patient.address;
          } else if (choice === "manual" || choice === "edit manually") {
            if (conflict.field === "Phone") updates.phone = stringValue(manualFields.phone, 40) || patient.phone;
            if (conflict.field === "Email") updates.email = normalizeEmail(manualFields.email) || patient.email;
            if (conflict.field === "Date of Birth") {
              updates.dateOfBirth = toIsoDocumentDate(manualFields.dateOfBirth) || patient.dateOfBirth;
            }
            if (conflict.field === "Address") updates.address = stringValue(manualFields.address, 300) || patient.address;
          }
        }
        if (Object.keys(updates).length) {
          try {
            await clinicalPatients.updateClinicalRecord(
              client,
              clinicalRecordId,
              updates,
              { id: req.admin.id, role: "admin-sync" }
            );
          } catch (updateError) {
            if (updateError.status !== 403) throw updateError;
          }
        }
      }

      let treatment = null;
      const savedTreatments = [];
      let skippedDuplicates = 0;

      if (hasVisitTable) {
        for (const row of datedVisitRows) {
          const iso = toIsoDocumentDate(row.treatmentDate);
          if (!isIsoDate(iso)) {
            skippedUndated += 1;
            continue;
          }
          const amountCharged = Number(String(row.amountCharged || "0").replace(/(?:₱|php)/gi, "").replace(/,/g, ""));
          const amountPaid = Number(String(row.amountPaid || "0").replace(/(?:₱|php)/gi, "").replace(/,/g, ""));
          const charged = Number.isFinite(amountCharged) && amountCharged >= 0 ? amountCharged : 0;
          const paid = Number.isFinite(amountPaid) && amountPaid >= 0 ? amountPaid : 0;
          let dup;
          try {
            dup = await clinicalPatients.withSavepoint(client, "doc_sync_dup", async () =>
              client.query(
                `SELECT id
                 FROM clinic_patient_treatments
                 WHERE clinical_record_id = $1
                   AND treatment_date = $2::date
                   AND LOWER(TRIM(treatment)) = LOWER(TRIM($3))
                   AND COALESCE(amount_charged, 0) = COALESCE($4::numeric, 0)
                 LIMIT 1`,
                [clinicalRecordId, iso, row.treatment, String(charged)]
              )
            );
          } catch {
            skippedUndated += 1;
            continue;
          }
          if (dup.rows.length) {
            skippedDuplicates += 1;
            continue;
          }
          const rowNotes = [
            row.balance ? `Balance: ${row.balance}` : null,
            row.nextAppt ? `Next Appt.: ${row.nextAppt}` : null,
          ]
            .filter(Boolean)
            .join(". ");
          try {
            const createdTreatment = await clinicalPatients.addClinicalTreatment(
              client,
              clinicalRecordId,
              {
                treatment: row.treatment,
                dentistName: row.dentistName || "",
                clinicLocation: procedure.clinicLocation || "Amethyst Dental Clinic",
                coverageStatus: "",
                status: "completed",
                treatmentDate: iso,
                toothNumber: row.toothNos || "",
                amountCharged: charged,
                amountPaid: paid,
                notes: rowNotes || "",
              },
              { id: req.admin.id, role: "admin-sync" }
            );
            savedTreatments.push(createdTreatment);
          } catch (treatError) {
            if (treatError?.status === 400 || treatError?.code) {
              skippedUndated += 1;
              continue;
            }
            throw treatError;
          }
        }
        treatment = savedTreatments[0] || null;
      } else if (procedure.treatment && isIsoDate(primaryDateIso || toIsoDocumentDate(procedure.treatmentDate))) {
        const iso = primaryDateIso || toIsoDocumentDate(procedure.treatmentDate);
        try {
          treatment = await clinicalPatients.addClinicalTreatment(
            client,
            clinicalRecordId,
            {
              treatment: procedure.treatment,
              dentistName: procedure.dentistName,
              clinicLocation: procedure.clinicLocation || "Amethyst Dental Clinic",
              coverageStatus: procedure.coverageStatus,
              status: procedure.status || "completed",
              treatmentDate: iso,
              amountCharged: Number(String(procedure.amountCharged || "0").replace(/(?:₱|php)/gi, "").replace(/,/g, "")) || 0,
              notes: procedure.notes || "",
            },
            { id: req.admin.id, role: "admin-sync" }
          );
          savedTreatments.push(treatment);
        } catch (treatError) {
          if (treatError?.status === 400 || treatError?.code) {
            skippedUndated += 1;
          } else {
            throw treatError;
          }
        }
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
            savedTreatments.length
              ? ` (${savedTreatments.length} treatment row${savedTreatments.length === 1 ? "" : "s"})`
              : ""
          }${skippedDuplicates ? `; skipped ${skippedDuplicates} duplicate row(s)` : ""}. Source document discarded.`,
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
          createdNewPatient ? "Created new patient record" : "Merged with existing patient after admin confirmation",
          treatment?.id ? `Treatments saved: ${savedTreatments.length}` : "No treatment row (patient info only)",
          skippedDuplicates ? `Duplicates skipped: ${skippedDuplicates}` : null,
          matchReason ? `Match: ${matchReason}` : null,
          "Temporary source document deleted; only structured data retained",
        ]
          .filter(Boolean)
          .join(". "),
      });

      const refreshed = await db.query(
        `SELECT * FROM admin_portal_document_sync_jobs WHERE id = $1`,
        [job.id]
      );

      const skipNotes = [
        skippedDuplicates ? `Duplicates skipped: ${skippedDuplicates}` : null,
        skippedUndated ? `Treatment rows skipped (unreadable date): ${skippedUndated}` : null,
      ].filter(Boolean);

      return res.json({
        message: [
          "Document successfully imported and data saved. The original source document was deleted.",
          ...skipNotes,
        ].join(" "),
        job: mapJob(refreshed.rows[0]),
        linked: {
          clinicalRecordId: String(clinicalRecordId),
          treatmentId: treatment?.id || null,
          createdNewPatient,
          matchReason,
        },
      });
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK").catch(() => {});
      }
      await writeAdminAudit(db, {
        ...auditActor(req),
        action: "Document Data Import",
        targetType: "document_sync",
        targetId: req.params.id ? String(req.params.id) : null,
        result: "failed",
        detail: error.message || "Unable to save document data.",
      }).catch(() => {});
      console.error("Document sync commit error:", error.message, error.code || "");
      const aborted = error.code === "25P02";
      return res.status(error.status || 500).json({
        message: aborted
          ? "Unable to save this document because a database step failed. Leave Date of Birth blank if unread, keep the treatment Date as a real calendar date, then try Confirm & Save again."
          : error.message || "Unable to sync document data to the database.",
      });
    } finally {
      client.release();
    }
  });
}

module.exports = {
  attachAdminDocumentSyncRoutes,
};
