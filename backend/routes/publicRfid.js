"use strict";

function registerPublicRfidRoutes(app, { db, notifyActiveStaff, notifyDentists }) {
  const rfidDeskCheckIn = require("../services/rfidDeskCheckIn");

  function authorizePublicRfidReader(req, res) {
    const decision = rfidDeskCheckIn.authorizePublicRfidRequest(req);
    if (!decision.ok) {
      res.status(decision.status).json(decision.body);
      return null;
    }
    return rfidDeskCheckIn;
  }

  app.get("/api/public/rfid-check-in", (req, res) => {
    if (!authorizePublicRfidReader(req, res)) return;
    return res.json({
      ok: true,
      connected: true,
      message: "ESP32 RFID reader is authorized on this API.",
    });
  });

  app.post("/api/public/rfid-check-in", async (req, res) => {
    const service = authorizePublicRfidReader(req, res);
    if (!service) return;
    try {
      const result = await service.checkInByRfidTag(db, {
        rfidTag: req.body?.rfidTag || req.body?.uid || req.body?.tag,
        notifyClinicStaff: (notification) => notifyActiveStaff(db, notification),
        notifyClinicDentists: (notification) => notifyDentists(db, notification),
      });
      if (!result.ok) {
        return res.status(result.status).json({
          message: result.message,
          errorCode: result.errorCode || undefined,
          patient: result.patient || undefined,
          diagnosis: result.diagnosis || undefined,
        });
      }
      return res.status(result.status).json(result.payload);
    } catch (error) {
      const { checkInFailureResponse, logCheckInFailure } = require("../services/postgresTxn");
      logCheckInFailure("Public RFID check-in", error);
      const failure = checkInFailureResponse(error);
      return res.status(failure.status).json({
        message: failure.message,
        errorCode: failure.errorCode,
        code: failure.code,
      });
    }
  });
}

module.exports = { registerPublicRfidRoutes };
