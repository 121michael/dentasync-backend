"use strict";

const accountDependents = require("../services/accountDependents");

function numericId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function sendServiceError(res, error, fallback) {
  if (error?.status) {
    return res.status(error.status).json({ message: error.message });
  }
  if (error?.code === "42P01" || error?.code === "42703") {
    return res.status(503).json({
      message: "Dependent approval is not available. Run npm run migrate:account-dependents.",
    });
  }
  console.error(fallback, error.message);
  return res.status(500).json({ message: fallback });
}

function attachAdminDependentRoutes(router, { db }) {
  router.get("/dependents/pending", async (_req, res) => {
    try {
      const dependents = await accountDependents.listPendingForAdmin(db);
      return res.json({ dependents, requests: dependents });
    } catch (error) {
      return sendServiceError(res, error, "Unable to load pending dependents.");
    }
  });

  router.get("/dependents", async (_req, res) => {
    try {
      const [pending, reviewed] = await Promise.all([
        accountDependents.listPendingForAdmin(db),
        accountDependents.listReviewedForAdmin(db),
      ]);
      return res.json({ pending, reviewed });
    } catch (error) {
      return sendServiceError(res, error, "Unable to load dependent requests.");
    }
  });

  router.get("/dependents/:id", async (req, res) => {
    const id = numericId(req.params.id);
    if (!id) {
      return res.status(400).json({ message: "A valid dependent request ID is required." });
    }
    try {
      const dependent = await accountDependents.getForAdmin(db, id);
      if (!dependent) {
        return res.status(404).json({ message: "Dependent request was not found." });
      }
      return res.json({ dependent });
    } catch (error) {
      return sendServiceError(res, error, "Unable to load the dependent request.");
    }
  });

  router.post("/dependents/:id/approve", async (req, res) => {
    const id = numericId(req.params.id);
    if (!id) {
      return res.status(400).json({ message: "A valid dependent request ID is required." });
    }
    try {
      const dependent = await accountDependents.approveDependent(db, id, req.user);
      return res.json({
        message: `${dependent.fullName} is now an approved dependent.`,
        dependent,
      });
    } catch (error) {
      return sendServiceError(res, error, "Unable to approve the dependent.");
    }
  });

  router.post("/dependents/:id/reject", async (req, res) => {
    const id = numericId(req.params.id);
    if (!id) {
      return res.status(400).json({ message: "A valid dependent request ID is required." });
    }
    try {
      const confirmed = req.body?.confirmed === true || req.body?.confirm === true;
      const dependent = await accountDependents.rejectDependent(db, id, req.user, {
        confirmed,
        reason: req.body?.reason || req.body?.rejectionReason,
      });
      return res.json({
        message: `${dependent.fullName}'s dependent request was rejected.`,
        dependent,
      });
    } catch (error) {
      return sendServiceError(res, error, "Unable to reject the dependent.");
    }
  });
}

module.exports = {
  attachAdminDependentRoutes,
};
