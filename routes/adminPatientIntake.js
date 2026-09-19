"use strict";

/**
 * Admin-only patient document intake API.
 * Mounted on the admin router (authenticateToken + requireAdminAccount already applied),
 * so Staff/Dentist/Patient tokens never reach these handlers.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const intake = require("../services/patientDocumentIntake");
const { UNSUPPORTED_DOCUMENT_MESSAGE } = require("../services/documentSyncExtraction");
const { writeAdminAudit } = require("../services/adminAudit");

const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/jpg"]);
const ALLOWED_EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg"]);
const MAX_FILE_BYTES = 15 * 1024 * 1024;

function numericId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function auditActor(req) {
  return {
    actorId: req.admin?.id ? String(req.admin.id) : null,
    actorName:
      `${req.admin?.first_name || ""} ${req.admin?.last_name || ""}`.trim() || req.admin?.email || "Admin",
    actorRole: "admin",
    ipAddress: req.ip || null,
  };
}

function sendError(res, error, fallback) {
  if (intake.isMissingRelation(error)) {
    return res.status(503).json({
      message: "Patient document intake tables are not available. Run npm run migrate:patient-document-intake.",
    });
  }
  const status = error?.status || 500;
  if (status >= 500) console.error(`${fallback}:`, error?.message || error);
  const body = { message: status >= 500 ? fallback : error.message };
  for (const key of ["code", "validation", "conflicts", "matches", "documentId"]) {
    if (error?.[key] !== undefined) body[key] = error[key];
  }
  return res.status(status).json(body);
}

function attachAdminPatientIntakeRoutes(router, { db, uploadDirectory }) {
  intake.ensureUploadDirectory(uploadDirectory);

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, callback) => callback(null, uploadDirectory),
      filename: (_req, file, callback) => {
        const extension = path.extname(file.originalname || "").toLowerCase() || ".bin";
        callback(null, `${crypto.randomUUID()}${extension}`);
      },
    }),
    limits: { fileSize: MAX_FILE_BYTES, files: 1 },
    fileFilter: (_req, file, callback) => {
      const extension = path.extname(file.originalname || "").toLowerCase();
      if (!ALLOWED_TYPES.has(file.mimetype) || !ALLOWED_EXTENSIONS.has(extension)) {
        return callback(new Error(UNSUPPORTED_DOCUMENT_MESSAGE));
      }
      callback(null, true);
    },
  });

  router.get("/patient-intake/sessions", async (req, res) => {
    try {
      const sessions = await intake.listSessions(db, uploadDirectory, {
        limit: Number.parseInt(req.query.limit, 10) || 20,
      });
      return res.json({ sessions });
    } catch (error) {
      return sendError(res, error, "Unable to load patient intake sessions.");
    }
  });

  router.post("/patient-intake/sessions", async (req, res) => {
    try {
      const session = await intake.createSession(db, req.admin);
      return res.status(201).json({ session });
    } catch (error) {
      return sendError(res, error, "Unable to start a patient intake session.");
    }
  });

  router.get("/patient-intake/sessions/:id", async (req, res) => {
    const sessionId = numericId(req.params.id);
    if (!sessionId) return res.status(400).json({ message: "A valid intake session id is required." });
    try {
      const session = await intake.getSession(db, sessionId, uploadDirectory);
      return res.json({ session });
    } catch (error) {
      return sendError(res, error, "Unable to load the patient intake session.");
    }
  });

  router.post("/patient-intake/sessions/:id/documents", (req, res) => {
    const sessionId = numericId(req.params.id);
    if (!sessionId) return res.status(400).json({ message: "A valid intake session id is required." });

    upload.single("document")(req, res, async (uploadError) => {
      if (uploadError) {
        const message =
          uploadError.code === "LIMIT_FILE_SIZE"
            ? "The document is too large. Upload a file smaller than 15 MB."
            : uploadError.message;
        await writeAdminAudit(db, {
          ...auditActor(req),
          action: "Patient Document Rejected",
          targetType: "patient_intake",
          targetId: String(sessionId),
          result: "failed",
          detail: message,
        });
        return res.status(400).json({ message, code: "INVALID_DOCUMENT" });
      }
      if (!req.file) {
        return res.status(400).json({ message: "Choose a document to upload or scan.", code: "INVALID_DOCUMENT" });
      }

      const sourceType = req.body?.sourceType === "scan" ? "scan" : "upload";
      try {
        const result = await intake.processDocument(db, sessionId, req.file, {
          sourceType,
          admin: req.admin,
          uploadDirectory,
        });
        await writeAdminAudit(db, {
          ...auditActor(req),
          action: "Patient Document Processed",
          targetType: "patient_intake",
          targetId: String(sessionId),
          targetLabel: req.file.originalname,
          result: "success",
          detail: `OCR extraction (${sourceType}). ${result.readableFields} field(s) read across ${result.document.pageCount} page(s). Pending Admin review.`,
        });
        return res.status(201).json({
          message: `Document processed — ${result.readableFields} field${result.readableFields === 1 ? "" : "s"} read. Review the extracted information before saving.`,
          session: result.session,
          document: result.document,
        });
      } catch (error) {
        await writeAdminAudit(db, {
          ...auditActor(req),
          action: "Patient Document Processed",
          targetType: "patient_intake",
          targetId: String(sessionId),
          targetLabel: req.file?.originalname || null,
          result: "failed",
          detail: error.message,
        });
        return sendError(res, error, "Unable to process the document.");
      }
    });
  });

  router.get("/patient-intake/sessions/:id/documents/:documentId/file", async (req, res) => {
    const sessionId = numericId(req.params.id);
    const documentId = numericId(req.params.documentId);
    if (!sessionId || !documentId) return res.status(400).json({ message: "Invalid document reference." });
    try {
      const file = await intake.getDocumentFile(db, sessionId, documentId, uploadDirectory);
      res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
      res.setHeader("Content-Disposition", `inline; filename="${String(file.originalName).replace(/"/g, "")}"`);
      res.setHeader("Cache-Control", "private, no-store");
      return res.sendFile(file.filePath);
    } catch (error) {
      return sendError(res, error, "Unable to load the document preview.");
    }
  });

  router.delete("/patient-intake/sessions/:id/documents/:documentId", async (req, res) => {
    const sessionId = numericId(req.params.id);
    const documentId = numericId(req.params.documentId);
    if (!sessionId || !documentId) return res.status(400).json({ message: "Invalid document reference." });
    try {
      const session = await intake.removeDocument(db, sessionId, documentId, uploadDirectory);
      await writeAdminAudit(db, {
        ...auditActor(req),
        action: "Patient Document Removed",
        targetType: "patient_intake",
        targetId: String(sessionId),
        result: "success",
        detail: `Document ${documentId} removed from intake before saving.`,
      });
      return res.json({ message: "Document removed.", session });
    } catch (error) {
      return sendError(res, error, "Unable to remove the document.");
    }
  });

  router.put("/patient-intake/sessions/:id", async (req, res) => {
    const sessionId = numericId(req.params.id);
    if (!sessionId) return res.status(400).json({ message: "A valid intake session id is required." });
    const edits = req.body?.fields && typeof req.body.fields === "object" ? req.body.fields : {};
    const resolveConflicts =
      req.body?.resolveConflicts && typeof req.body.resolveConflicts === "object" ? req.body.resolveConflicts : {};
    try {
      const session = await intake.updateSessionFields(
        db,
        sessionId,
        {
          edits,
          resolveConflicts,
          categoryConfirmed:
            typeof req.body?.categoryConfirmed === "boolean" ? req.body.categoryConfirmed : undefined,
        },
        uploadDirectory
      );
      const edited = Object.keys(edits);
      const resolved = Object.keys(resolveConflicts);
      if (edited.length || resolved.length) {
        await writeAdminAudit(db, {
          ...auditActor(req),
          action: "Patient Intake Corrected",
          targetType: "patient_intake",
          targetId: String(sessionId),
          result: "success",
          detail: [
            edited.length ? `Edited: ${edited.join(", ")}` : null,
            resolved.length ? `Conflicts resolved: ${resolved.join(", ")}` : null,
          ]
            .filter(Boolean)
            .join(". "),
        });
      }
      return res.json({ message: "Patient information updated.", session });
    } catch (error) {
      return sendError(res, error, "Unable to save the reviewed information.");
    }
  });

  router.post("/patient-intake/sessions/:id/matches", async (req, res) => {
    const sessionId = numericId(req.params.id);
    if (!sessionId) return res.status(400).json({ message: "A valid intake session id is required." });
    try {
      const session = await intake.getSession(db, sessionId, uploadDirectory);
      const matches = await intake.findPatientMatches(db, session.fields);
      return res.json({ matches, isNewPatient: !matches.length });
    } catch (error) {
      return sendError(res, error, "Unable to check for existing patients.");
    }
  });

  router.post("/patient-intake/sessions/:id/confirm", async (req, res) => {
    const sessionId = numericId(req.params.id);
    if (!sessionId) return res.status(400).json({ message: "A valid intake session id is required." });
    const link =
      req.body?.link && ["account", "clinical_record"].includes(req.body.link.type) && req.body.link.id
        ? { type: req.body.link.type, id: String(req.body.link.id) }
        : null;
    const createNew = Boolean(req.body?.createNew);
    const applyFields = Array.isArray(req.body?.applyFields) ? req.body.applyFields.map(String) : [];

    try {
      const result = await intake.confirmSession(
        db,
        sessionId,
        { admin: req.admin, link, createNew, applyFields },
        uploadDirectory
      );
      await writeAdminAudit(db, {
        ...auditActor(req),
        action: "Patient Intake Confirmed",
        targetType: "clinical_patient",
        targetId: result.record?.id ? String(result.record.id) : null,
        targetLabel: result.patientId || result.record?.fullName || null,
        result: "success",
        detail: [
          result.createdNewPatient ? "Created new patient record from reviewed document data" : "Attached documents to existing patient",
          result.patientId ? `Patient ID: ${result.patientId}` : null,
          applyFields.length ? `Applied fields: ${applyFields.join(", ")}` : null,
          "Account verification NOT changed (separate Admin action).",
        ]
          .filter(Boolean)
          .join(". "),
      });
      return res.json({
        message: result.createdNewPatient
          ? `Patient record created${result.patientId ? ` with Patient ID ${result.patientId}` : ""}. Verification remains a separate step.`
          : "Reviewed information saved to the existing patient record.",
        ...result,
      });
    } catch (error) {
      await writeAdminAudit(db, {
        ...auditActor(req),
        action: "Patient Intake Confirmed",
        targetType: "patient_intake",
        targetId: String(sessionId),
        result: error?.status && error.status < 500 ? "blocked" : "failed",
        detail: error.message,
      });
      return sendError(res, error, "Unable to save the patient information.");
    }
  });

  router.post("/patient-intake/sessions/:id/cancel", async (req, res) => {
    const sessionId = numericId(req.params.id);
    if (!sessionId) return res.status(400).json({ message: "A valid intake session id is required." });
    try {
      const session = await intake.cancelSession(db, sessionId, uploadDirectory);
      return res.json({ message: "Intake cancelled. Temporary documents discarded.", session });
    } catch (error) {
      return sendError(res, error, "Unable to cancel the intake session.");
    }
  });

  /** Documents attached to a canonical patient record (Admin view). */
  router.get("/patients/:id/documents", async (req, res) => {
    const userId = String(req.params.id || "").trim();
    if (!userId) return res.status(400).json({ message: "A valid patient id is required." });
    try {
      const documents = await intake.listPatientDocuments(db, { userId }, uploadDirectory);
      return res.json({ documents });
    } catch (error) {
      return sendError(res, error, "Unable to load patient documents.");
    }
  });

  router.get("/clinical-records/:id/documents", async (req, res) => {
    const recordId = numericId(req.params.id);
    if (!recordId) return res.status(400).json({ message: "A valid clinical record id is required." });
    try {
      const documents = await intake.listPatientDocuments(db, { clinicalRecordId: recordId }, uploadDirectory);
      return res.json({ documents });
    } catch (error) {
      return sendError(res, error, "Unable to load patient documents.");
    }
  });

  router.get("/patient-documents/:documentId/file", async (req, res) => {
    const documentId = numericId(req.params.documentId);
    if (!documentId) return res.status(400).json({ message: "Invalid document reference." });
    try {
      const result = await db.query(`SELECT * FROM patient_documents WHERE id = $1 AND status = 'attached'`, [documentId]);
      if (!result.rows.length) return res.status(404).json({ message: "Document not found." });
      const row = result.rows[0];
      const filePath = row.stored_name ? intake.resolveTempDocumentPath(uploadDirectory, row.stored_name) : null;
      if (!filePath || !fs.existsSync(filePath)) {
        return res.status(410).json({ message: "Document file is no longer available." });
      }
      res.setHeader("Content-Type", row.mime_type || "application/octet-stream");
      res.setHeader("Content-Disposition", `inline; filename="${String(row.original_name).replace(/"/g, "")}"`);
      res.setHeader("Cache-Control", "private, no-store");
      return res.sendFile(filePath);
    } catch (error) {
      return sendError(res, error, "Unable to load the document.");
    }
  });
}

module.exports = { attachAdminPatientIntakeRoutes };
