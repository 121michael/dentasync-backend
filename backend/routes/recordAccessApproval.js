"use strict";

const express = require("express");
const recordAccess = require("../services/recordAccess");
const recordAccessCredential = require("../services/recordAccessCredential");

function sendAccessError(res, error, fallback) {
  if (error?.status) {
    return res.status(error.status).json({
      message: error.message,
      code: error.code,
    });
  }
  console.error(fallback, error.message);
  return res.status(500).json({ message: fallback });
}

function createRecordAccessApprovalRouter({ db, authenticateToken }) {
  const router = express.Router();
  router.use(authenticateToken);

  router.get("/approver", async (req, res) => {
    try {
      const status = await recordAccess.sessionApproverStatus(db, req.user);
      return res.json(status);
    } catch (error) {
      return sendAccessError(res, error, "Unable to check authorization access.");
    }
  });

  router.get("/challenges/:code", async (req, res) => {
    try {
      const challenge = await recordAccess.previewChallenge(db, req, req.params.code);
      return res.json({ challenge });
    } catch (error) {
      return sendAccessError(res, error, "Unable to load this authorization.");
    }
  });

  router.post("/challenges/:code/approve", async (req, res) => {
    try {
      const result = await recordAccess.authorizeChallenge(db, req, { code: req.params.code });
      const payload = {
        message: "Restricted records are available for the approved scope.",
        grant: result.grant
          ? {
              id: result.grant.id,
              status: result.grant.status,
              expiresAt: result.grant.expires_at,
              scope: result.grant.scope,
            }
          : null,
        minutes: result.minutes,
      };
      if (recordAccessCredential.containsSecret(payload, req.body?.secret)) {
        return res.status(500).json({ message: "Unable to authorize this access." });
      }
      return res.json(payload);
    } catch (error) {
      return sendAccessError(res, error, "Unable to authorize this access.");
    }
  });

  return router;
}

module.exports = { createRecordAccessApprovalRouter };
