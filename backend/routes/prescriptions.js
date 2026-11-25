"use strict";

const fs = require("fs");
const prescriptions = require("../services/prescriptions");
const clinicalPatients = require("../services/clinicalPatients");
const recordAccess = require("../services/recordAccess");

function sendError(res, error) {
  const status = Number(error.status) || (error.code === "42P01" || error.code === "42703" ? 503 : 500);
  if (status >= 500 && status !== 503) {
    console.error("Prescription error:", error.message);
  }
  const message =
    status === 503
      ? "Prescription tables could not be created. Check the database connection, then restart the API so it can apply migrations/045_prescriptions.sql."
      : error.message || "Unable to process this prescription.";
  return res.status(status).json({ message });
}

function attachPrescriptionRoutes(router, { db, role, uploadDirectory, notifyStaff = async () => {} }) {
  const directory = uploadDirectory || prescriptions.DEFAULT_UPLOAD_DIR;

  function staffBranchId(req) {
    if (role !== "staff" || req.branchAccess?.legacy) return undefined;
    return req.branchAccess?.activeBranch?.id || null;
  }

  async function requireStaffBranch(req, prescriptionId) {
    const branchId = staffBranchId(req);
    if (branchId === undefined) return;
    await prescriptions.assertStaffBranch(db, prescriptionId, branchId);
  }

  router.get("/prescriptions", async (req, res) => {
    try {
      const branchId = staffBranchId(req);
      if (branchId === null) return res.json({ prescriptions: [] });
      const clinicalRecordId = req.query.patientId || req.query.clinicalRecordId;
      if (clinicalRecordId) await requirePatientEligibility(req, clinicalRecordId);
      const list = await prescriptions.listPrescriptions(db, {
        clinicalRecordId,
        workflowStatus: req.query.status,
        search: req.query.search,
        staffBranchId: branchId,
      });
      return res.json({ prescriptions: list });
    } catch (error) {
      return sendError(res, error);
    }
  });

  async function requirePatientEligibility(req, patientId) {
    const recordId = Number.parseInt(patientId, 10);
    if (!Number.isSafeInteger(recordId) || recordId <= 0) {
      const error = new Error("A valid patient record ID is required.");
      error.status = 400;
      throw error;
    }
    const detail = await clinicalPatients.getClinicalRecord(db, recordId);
    if (!detail || detail.record.archived) {
      const error = new Error("Patient record not found.");
      error.status = 404;
      throw error;
    }
    const branchId = req.branchAccess?.activeBranch?.id;
    if (role === "staff") {
      const relationship = await recordAccess.staffQualifyingRelationship(db, detail.record, branchId);
      if (!relationship.allowed) {
        const error = new Error("Patient record not found.");
        error.status = 404;
        throw error;
      }
      return;
    }
    if (role === "dentist") {
      if (!branchId) {
        throw recordAccess.denyNoRelationship(detail.record, { includeIdentity: true });
      }
      const assigned = await recordAccess.dentistAssignedToBranch(db, req.dentist, branchId);
      if (!assigned) throw recordAccess.denyNoRelationship(detail.record, { includeIdentity: true });
    }
  }

  router.get("/patients/:patientId/prescriptions", async (req, res) => {
    try {
      const branchId = staffBranchId(req);
      if (branchId === null) return res.json({ prescriptions: [] });
      await requirePatientEligibility(req, req.params.patientId);
      let list = await prescriptions.listPrescriptions(db, {
        clinicalRecordId: req.params.patientId,
        staffBranchId: role === "staff" ? branchId : undefined,
      });
      if (role === "dentist") {
        const grants = await recordAccess.activeGrants(db, req.dentist.id, req.params.patientId);
        const encounterBranchIds = req.branchAccess?.activeBranch?.id
          ? [String(req.branchAccess.activeBranch.id)]
          : [];
        list = list.filter((row) =>
          recordAccess.treatmentHistoryVisible(row, { encounterBranchIds, grants })
        );
      }
      return res.json({ prescriptions: list });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get("/prescriptions/:id", async (req, res) => {
    try {
      await requireStaffBranch(req, req.params.id);
      const detail = await prescriptions.loadDetail(db, req.params.id);
      if (role === "staff") {
        detail.recipientEmail = undefined;
      }
      return res.json({ prescription: detail });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get("/prescriptions/:id/pdf", async (req, res) => {
    try {
      await requireStaffBranch(req, req.params.id);
      const actor = role === "dentist" ? req.dentist : req.staff;
      const loader =
        role === "staff" ? prescriptions.retrieveStoredPdf : prescriptions.generateOrRetrievePdf;
      const { filePath, storedName, prescription } = await loader(db, {
        actorId: String(actor.id),
        actorRole: role,
        prescriptionId: req.params.id,
        uploadDirectory: directory,
        recordView: role === "staff",
      });
      const inline = String(req.query.inline || "") === "1";
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader(
        "Content-Disposition",
        `${inline ? "inline" : "attachment"}; filename="${storedName || `prescription-v${prescription.version}.pdf`}"`
      );
      return fs.createReadStream(filePath).pipe(res);
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get("/prescriptions/:id/jpeg", async (req, res) => {
    try {
      await requireStaffBranch(req, req.params.id);
      const actor = role === "dentist" ? req.dentist : req.staff;
      const { pages, prescription } = await prescriptions.generateOrRetrieveJpeg(db, {
        actorId: String(actor.id),
        actorRole: role,
        prescriptionId: req.params.id,
        uploadDirectory: directory,
      });
      const pageIndex = Math.max(0, Number.parseInt(req.query.page, 10) || 1) - 1;
      const image = pages[pageIndex] || pages[0];
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("X-Prescription-Pages", String(pages.length));
      res.setHeader(
        "Content-Disposition",
        `inline; filename="prescription-v${prescription.version}-p${pageIndex + 1}.jpg"`
      );
      return res.send(image);
    } catch (error) {
      return sendError(res, error);
    }
  });

  if (role === "dentist") {
    router.post("/prescriptions", async (req, res) => {
      try {
        const prescription = await prescriptions.createPrescription(db, {
          dentist: req.dentist,
          body: req.body || {},
          branchAccess: req.branchAccess,
        });
        return res.status(201).json({ prescription, message: "Draft prescription saved." });
      } catch (error) {
        return sendError(res, error);
      }
    });

    router.patch("/prescriptions/:id", async (req, res) => {
      try {
        const prescription = await prescriptions.updateDraft(db, {
          dentist: req.dentist,
          prescriptionId: req.params.id,
          body: req.body || {},
        });
        return res.json({ prescription, message: "Prescription updated." });
      } catch (error) {
        return sendError(res, error);
      }
    });

    router.post("/prescriptions/:id/submit", async (req, res) => {
      try {
        const prescription = await prescriptions.submitToStaff(db, {
          dentist: req.dentist,
          prescriptionId: req.params.id,
        });
        let notificationWarning = "";
        if (role === "dentist") {
          const patientName = prescription.patient?.fullName || "a patient";
          const signed = prescription.workflowStatus === "authorized" && prescription.signedAt;
          try {
            await notifyStaff({
              type: "prescription",
              title: "Prescription sent to staff",
              body: signed
                ? `${prescription.prescriptionNumber} for ${patientName} (version ${prescription.currentVersion}) is signed and ready for staff processing.`
                : `${prescription.prescriptionNumber} for ${patientName} (version ${prescription.currentVersion}) was sent to staff for processing.`,
              entityType: "prescription",
              entityId: String(prescription.id),
              dedupe: true,
              branchId: prescription.originatingBranchId || null,
              unscoped: Boolean(req.branchAccess?.legacy),
            });
          } catch (notifyError) {
            console.warn("Staff prescription notification was not created:", notifyError.message);
            notificationWarning =
              "The prescription was sent, but staff notifications could not be saved. Staff can still open it from Prescription Processing.";
          }
        }
        return res.json({
          prescription,
          message: "Prescription sent to staff for processing.",
          ...(notificationWarning ? { notificationWarning } : {}),
        });
      } catch (error) {
        return sendError(res, error);
      }
    });

    router.post("/prescriptions/:id/authorize", async (req, res) => {
      try {
        const prescription = await prescriptions.authorize(db, {
          dentist: req.dentist,
          prescriptionId: req.params.id,
          signaturePng: req.body?.signaturePng,
        });
        return res.json({
          prescription,
          message: "This version is signed and authorized. Staff can generate and email only this version.",
        });
      } catch (error) {
        return sendError(res, error);
      }
    });

    router.post("/prescriptions/:id/cancel", async (req, res) => {
      try {
        const prescription = await prescriptions.cancelPrescription(db, {
          actorId: String(req.dentist.id),
          actorRole: "dentist",
          prescriptionId: req.params.id,
        });
        return res.json({ prescription, message: "Prescription cancelled." });
      } catch (error) {
        return sendError(res, error);
      }
    });
  }

  if (role === "staff") {
    router.post("/prescriptions/:id/process", async (req, res) => {
      try {
        await requireStaffBranch(req, req.params.id);
        const prescription = await prescriptions.markProcessing(db, {
          staff: req.staff,
          prescriptionId: req.params.id,
        });
        return res.json({ prescription, message: "Prescription marked as processing." });
      } catch (error) {
        return sendError(res, error);
      }
    });

    router.post("/prescriptions/:id/generate", async (req, res) => {
      try {
        await requireStaffBranch(req, req.params.id);
        const generated = await prescriptions.generateOrRetrievePdf(db, {
          actorId: String(req.staff.id),
          actorRole: "staff",
          prescriptionId: req.params.id,
          uploadDirectory: directory,
          forceRegenerate: Boolean(req.body?.regenerate),
        });
        const prescription = await prescriptions.loadDetail(db, req.params.id);
        return res.json({
          prescription,
          message: generated.created
            ? "Prescription PDF generated and stored."
            : "This authorized version already has a stored PDF.",
        });
      } catch (error) {
        return sendError(res, error);
      }
    });

    router.post("/prescriptions/:id/confirm-review", async (req, res) => {
      try {
        await requireStaffBranch(req, req.params.id);
        const prescription = await prescriptions.confirmPdfReview(db, {
          staff: req.staff,
          prescriptionId: req.params.id,
          confirmPdfId: req.body?.confirmPdfId,
          uploadDirectory: directory,
        });
        return res.json({
          prescription,
          message: "PDF review recorded for this generated version. Prepare email is now available.",
        });
      } catch (error) {
        return sendError(res, error);
      }
    });

    router.post("/prescriptions/:id/return", async (req, res) => {
      try {
        await requireStaffBranch(req, req.params.id);
        const prescription = await prescriptions.returnToDentist(db, {
          staff: req.staff,
          prescriptionId: req.params.id,
          reason: req.body?.reason,
        });
        return res.json({ prescription, message: "Returned to the dentist for clinical correction." });
      } catch (error) {
        return sendError(res, error);
      }
    });

    router.post("/prescriptions/:id/prepare-send", async (req, res) => {
      try {
        await requireStaffBranch(req, req.params.id);
        const prepared = await prescriptions.prepareSend(db, {
          staff: req.staff,
          prescriptionId: req.params.id,
          uploadDirectory: directory,
        });
        return res.json({
          confirmation: prepared.confirmation,
          message: "Confirm the recipient and authorized version before sending.",
        });
      } catch (error) {
        return sendError(res, error);
      }
    });

    router.post("/prescriptions/:id/send", async (req, res) => {
      try {
        await requireStaffBranch(req, req.params.id);
        const prescription = await prescriptions.sendAuthorizedEmail(db, {
          staff: req.staff,
          prescriptionId: req.params.id,
          confirmPrescriptionId: req.body?.confirmPrescriptionId,
          confirmVersion: req.body?.confirmVersion,
          confirmRecipientMasked: req.body?.confirmRecipientMasked,
          confirmPdfId: req.body?.confirmPdfId,
          uploadDirectory: directory,
        });
        return res.json({
          prescription,
          message: "The email provider accepted the authorized prescription PDF.",
        });
      } catch (error) {
        return sendError(res, error);
      }
    });

    router.post("/prescriptions/:id/retry-send", async (req, res) => {
      try {
        await requireStaffBranch(req, req.params.id);
        const prescription = await prescriptions.retrySend(db, {
          staff: req.staff,
          prescriptionId: req.params.id,
          confirmPrescriptionId: req.body?.confirmPrescriptionId,
          confirmVersion: req.body?.confirmVersion,
          confirmRecipientMasked: req.body?.confirmRecipientMasked,
          confirmPdfId: req.body?.confirmPdfId,
          uploadDirectory: directory,
        });
        return res.json({ prescription, message: "Retry submitted for the authorized version." });
      } catch (error) {
        return sendError(res, error);
      }
    });
  }
}

module.exports = {
  attachPrescriptionRoutes,
};
