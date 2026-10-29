"use strict";

const fs = require("fs");
const prescriptions = require("../services/prescriptions");

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

function attachPrescriptionRoutes(router, { db, role, uploadDirectory }) {
  const directory = uploadDirectory || prescriptions.DEFAULT_UPLOAD_DIR;

  router.get("/prescriptions", async (req, res) => {
    try {
      const list = await prescriptions.listPrescriptions(db, {
        clinicalRecordId: req.query.patientId || req.query.clinicalRecordId,
        workflowStatus: req.query.status,
        search: req.query.search,
      });
      return res.json({ prescriptions: list });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get("/patients/:patientId/prescriptions", async (req, res) => {
    try {
      const list = await prescriptions.listPrescriptions(db, {
        clinicalRecordId: req.params.patientId,
      });
      return res.json({ prescriptions: list });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get("/prescriptions/:id", async (req, res) => {
    try {
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
      const actor = role === "dentist" ? req.dentist : req.staff;
      const { filePath, storedName, prescription } = await prescriptions.generateOrRetrievePdf(db, {
        actorId: String(actor.id),
        actorRole: role,
        prescriptionId: req.params.id,
        uploadDirectory: directory,
      });
      const inline = String(req.query.inline || "") === "1";
      res.setHeader("Content-Type", "application/pdf");
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
        return res.json({ prescription, message: "Prescription sent to staff for processing." });
      } catch (error) {
        return sendError(res, error);
      }
    });

    router.post("/prescriptions/:id/authorize", async (req, res) => {
      try {
        const prescription = await prescriptions.authorize(db, {
          dentist: req.dentist,
          prescriptionId: req.params.id,
        });
        return res.json({
          prescription,
          message: "This version is authorized. Staff can generate and email only this version.",
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
        const prescription = await prescriptions.markProcessing(db, {
          staff: req.staff,
          prescriptionId: req.params.id,
        });
        return res.json({ prescription, message: "Prescription marked as processing." });
      } catch (error) {
        return sendError(res, error);
      }
    });

    router.post("/prescriptions/:id/return", async (req, res) => {
      try {
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
        const prepared = await prescriptions.prepareSend(db, {
          staff: req.staff,
          prescriptionId: req.params.id,
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
        const prescription = await prescriptions.sendAuthorizedEmail(db, {
          staff: req.staff,
          prescriptionId: req.params.id,
          confirmPrescriptionId: req.body?.confirmPrescriptionId,
          confirmVersion: req.body?.confirmVersion,
          confirmRecipientMasked: req.body?.confirmRecipientMasked,
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
        const prescription = await prescriptions.retrySend(db, {
          staff: req.staff,
          prescriptionId: req.params.id,
          confirmPrescriptionId: req.body?.confirmPrescriptionId,
          confirmVersion: req.body?.confirmVersion,
          confirmRecipientMasked: req.body?.confirmRecipientMasked,
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
