"use strict";

const fs = require("fs");
const path = require("path");
const multer = require("multer");
const authorizations = require("../services/dentalProcedureAuthorization");
const recordAccess = require("../services/recordAccess");

function actorFrom(role, req) {
  if (role === "admin") return { ...req.admin, role: "admin" };
  if (role === "dentist") return { ...req.dentist, role: "dentist" };
  if (role === "staff") return { ...req.staff, role: "staff" };
  return { ...req.user, role: "patient" };
}

function sendError(res, error, fallback) {
  if (error?.code === "42P01") {
    return res.status(503).json({
      message:
        "Dental procedure authorizations are not available. Run npm run migrate:dental-authorizations, then restart the server.",
    });
  }
  if (error?.status) {
    return res.status(error.status).json({ message: error.message });
  }
  console.error(fallback, error.message);
  return res.status(500).json({ message: fallback });
}

function truthy(value) {
  return value === true || value === "true" || value === "1" || value === "on";
}

function attachDentalAuthorizationRoutes(router, { db, role, uploadDirectory }) {
  const directory = authorizations.ensureUploadDir(
    uploadDirectory || authorizations.DEFAULT_UPLOAD_DIR
  );
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, callback) => callback(null, directory),
      filename: (_req, file, callback) => {
        const extension = path.extname(file.originalname || "").toLowerCase();
        callback(null, `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}${extension}`);
      },
    }),
    limits: { fileSize: authorizations.MAX_UPLOAD_BYTES, files: 1 },
    fileFilter: (_req, file, callback) => {
      if (!authorizations.ALLOWED_MIME.has(String(file.mimetype || "").toLowerCase())) {
        return callback(new Error("Only PDF, JPG, and PNG authorization files are accepted."));
      }
      callback(null, true);
    },
  });

  async function consentReadable(req, clinicalRecordId, originatingBranchId) {
    if (role === "admin" || role === "patient") return true;
    let encounterBranchIds = [];
    let grants = [];
    if (role === "dentist") {
      const recordResult = await db.query(
        `SELECT id, linked_user_id FROM clinic_patient_records WHERE id = $1`,
        [clinicalRecordId]
      );
      const record = recordResult.rows[0];
      if (!record) return false;
      const relationship = await recordAccess.qualifyingRelationship(db, req.dentist, {
        id: record.id,
        linkedUserId: record.linked_user_id,
      });
      if (!relationship.allowed) return false;
      encounterBranchIds = relationship.branchIds;
      grants = await recordAccess.activeGrants(db, req.dentist.id, clinicalRecordId);
    } else if (role === "staff") {
      const staffBranchId = req.branchAccess?.activeBranch?.id;
      encounterBranchIds = staffBranchId ? [String(staffBranchId)] : [];
    }
    return recordAccess.restrictedAllowed({
      originatingBranchId,
      encounterBranchIds,
      grants,
      scope: "consent_forms",
    });
  }

  async function loadVisible(req) {
    const row = await authorizations.getById(db, req.params.id);
    if (!row) {
      const error = new Error("Authorization document not found.");
      error.status = 404;
      throw error;
    }
    const actor = actorFrom(role, req);
    authorizations.assertVisibleTo(role, actor.id, row);
    if (role !== "patient") {
      await authorizations.assertStaffAccess(role, db, row.clinical_record_id, row.linked_user_id);
    }
    if (role === "dentist" || role === "staff") {
      const allowed = await consentReadable(req, row.clinical_record_id, row.originating_branch_id);
      if (!allowed) {
        const error = new Error("Approval is required before this consent form can be opened.");
        error.status = 403;
        throw error;
      }
    }
    return { row, actor };
  }

  if (role === "patient") {
    router.get("/authorizations", async (req, res) => {
      try {
        const documents = await authorizations.listForPatientUser(db, actorFrom(role, req).id);
        return res.json({ documents });
      } catch (error) {
        return sendError(res, error, "Unable to load authorization documents.");
      }
    });
  } else {
    const patientParam = role === "admin" ? "/clinical-records/:patientId/authorizations" : "/patients/:patientId/authorizations";
    router.get(patientParam, async (req, res) => {
      try {
        const clinicalRecordId = Number.parseInt(req.params.patientId, 10);
        if (!Number.isSafeInteger(clinicalRecordId) || clinicalRecordId <= 0) {
          return res.status(400).json({ message: "A valid patient record ID is required." });
        }
        await authorizations.assertStaffAccess(role, db, clinicalRecordId);
        let documents = await authorizations.listForClinicalRecord(db, clinicalRecordId);
        if (role === "dentist" || role === "staff") {
          const visible = [];
          for (const document of documents) {
            if (await consentReadable(req, clinicalRecordId, document.originatingBranchId)) visible.push(document);
          }
          documents = visible;
        }
        return res.json({ documents, template: authorizations.TEMPLATE_TEXT });
      } catch (error) {
        return sendError(res, error, "Unable to load authorization documents.");
      }
    });

    router.post(patientParam, async (req, res) => {
      try {
        const clinicalRecordId = Number.parseInt(req.params.patientId, 10);
        if (!Number.isSafeInteger(clinicalRecordId) || clinicalRecordId <= 0) {
          return res.status(400).json({ message: "A valid patient record ID is required." });
        }
        const document = await authorizations.createAuthorization(db, {
          clinicalRecordId,
          body: req.body || {},
          actor: actorFrom(role, req),
          role,
        });
        const branchId = req.branchAccess?.activeBranch?.id;
        if (branchId && document?.id && (role === "dentist" || role === "staff")) {
          try {
            await db.query(
              `UPDATE dental_procedure_authorizations SET originating_branch_id = $2 WHERE id = $1`,
              [document.id, branchId]
            );
            document.originatingBranchId = Number(branchId);
          } catch (error) {
            if (error.code !== "42703") throw error;
          }
        }
        return res.status(201).json({ document });
      } catch (error) {
        return sendError(res, error, "Unable to generate the authorization document.");
      }
    });
  }

  router.get("/authorizations/:id", async (req, res) => {
    try {
      const { row } = await loadVisible(req);
      return res.json({
        document: authorizations.mapRow(row),
        template: role === "patient" ? undefined : authorizations.TEMPLATE_TEXT,
      });
    } catch (error) {
      return sendError(res, error, "Unable to load the authorization document.");
    }
  });

  router.get("/authorizations/:id/pdf", async (req, res) => {
    try {
      const { row } = await loadVisible(req);
      const pdf = await authorizations.buildPdf(db, row);
      const filename = `${row.document_number || "authorization"}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
      res.setHeader("Cache-Control", "private, no-store");
      return res.send(pdf);
    } catch (error) {
      return sendError(res, error, "Unable to generate the authorization PDF.");
    }
  });

  router.get("/authorizations/:id/file", async (req, res) => {
    try {
      const { row } = await loadVisible(req);
      if (!row.stored_name) {
        return res.status(404).json({ message: "No uploaded file is attached to this authorization." });
      }
      const filePath = authorizations.resolveStoredPath(directory, row.stored_name);
      if (!filePath || !fs.existsSync(filePath)) {
        return res.status(404).json({ message: "The uploaded authorization file is unavailable." });
      }
      res.setHeader("Cache-Control", "private, no-store");
      return res.download(filePath, row.original_name || "authorization");
    } catch (error) {
      return sendError(res, error, "Unable to download the authorization file.");
    }
  });

  if (role !== "patient") {
    router.post("/authorizations/:id/issue", async (req, res) => {
      try {
        const { actor } = await loadVisible(req);
        const document = await authorizations.issueForSignature(db, {
          id: req.params.id,
          actor,
          role,
        });
        return res.json({ document });
      } catch (error) {
        return sendError(res, error, "Unable to issue the authorization for signature.");
      }
    });

    router.post("/authorizations/:id/sign", async (req, res) => {
      try {
        const { actor } = await loadVisible(req);
        const document = await authorizations.recordSignature(db, {
          id: req.params.id,
          actor,
          role,
          body: req.body || {},
        });
        return res.json({ document });
      } catch (error) {
        return sendError(res, error, "Unable to record the authorization signature.");
      }
    });

    router.post("/authorizations/:id/void", async (req, res) => {
      try {
        const { actor } = await loadVisible(req);
        const document = await authorizations.voidAuthorization(db, {
          id: req.params.id,
          actor,
          role,
          reason: req.body?.reason,
        });
        return res.json({ document });
      } catch (error) {
        return sendError(res, error, "Unable to void the authorization.");
      }
    });

    router.post("/authorizations/:id/replace", async (req, res) => {
      try {
        const { actor } = await loadVisible(req);
        const document = await authorizations.replaceWithNewVersion(db, {
          id: req.params.id,
          actor,
          role,
          body: req.body || {},
        });
        return res.status(201).json({ document });
      } catch (error) {
        return sendError(res, error, "Unable to create a replacement authorization.");
      }
    });

    router.post("/authorizations/:id/upload", upload.single("file"), async (req, res) => {
      try {
        const { actor } = await loadVisible(req);
        const document = await authorizations.saveUpload(db, {
          id: req.params.id,
          actor,
          role,
          file: req.file,
          signedCopyConfirmed: truthy(req.body?.signedCopyConfirmed),
          uploadDirectory: directory,
        });
        if (req.file?.path) fs.unlink(req.file.path, () => {});
        return res.status(201).json({ document });
      } catch (error) {
        if (req.file?.path) fs.unlink(req.file.path, () => {});
        return sendError(res, error, "Unable to save the authorization upload.");
      }
    });
  }

  router.use((error, _req, res, next) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ message: "Authorization files must be 5 MB or smaller." });
      }
      return res.status(400).json({ message: error.message || "The uploaded document is not valid." });
    }
    if (error.message?.includes("Only PDF")) {
      return res.status(400).json({ message: error.message });
    }
    return next(error);
  });
}

module.exports = {
  attachDentalAuthorizationRoutes,
};
