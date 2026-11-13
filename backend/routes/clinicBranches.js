"use strict";

const clinicBranches = require("../services/clinicBranches");

function sendBranchError(res, error, fallback) {
  if (error?.status) {
    return res.status(error.status).json({ message: error.message });
  }
  if (error?.code === "42P01") {
    return res.status(503).json({
      message: "Branch management is not available. Run npm run migrate:clinic-branches, then restart the server.",
    });
  }
  if (error?.code === "23514") {
    return res.status(409).json({ message: error.message || "The Main Branch cannot be changed that way." });
  }
  console.error(fallback, error.message);
  return res.status(500).json({ message: fallback });
}

function attachClinicBranchRoutes(router, { db }) {
  router.get("/branches", async (req, res) => {
    try {
      const branches = await clinicBranches.listBranches(db, {
        search: typeof req.query.search === "string" ? req.query.search.trim() : "",
        status: typeof req.query.status === "string" ? req.query.status.trim().toLowerCase() : "",
      });
      return res.json({ branches, total: branches.length });
    } catch (error) {
      return sendBranchError(res, error, "Unable to load branches.");
    }
  });

  router.post("/branches", async (req, res) => {
    try {
      const branch = await clinicBranches.createBranch(db, req.body || {});
      return res.status(201).json({ message: "Branch created.", branch });
    } catch (error) {
      return sendBranchError(res, error, "Unable to create the branch.");
    }
  });

  router.get("/branches/:id", async (req, res) => {
    try {
      const branch = await clinicBranches.getBranch(db, req.params.id);
      if (!branch) return res.status(404).json({ message: "Branch not found." });
      return res.json({ branch });
    } catch (error) {
      return sendBranchError(res, error, "Unable to load the branch.");
    }
  });

  router.patch("/branches/:id", async (req, res) => {
    try {
      const branch = await clinicBranches.updateBranch(db, req.params.id, req.body || {});
      return res.json({ message: "Branch updated.", branch });
    } catch (error) {
      return sendBranchError(res, error, "Unable to update the branch.");
    }
  });

  router.post("/branches/:id/status", async (req, res) => {
    try {
      const branch = await clinicBranches.setBranchStatus(db, req.params.id, req.body?.status);
      const message = branch.status === "active" ? "Branch activated." : "Branch deactivated. Existing assignments were kept.";
      return res.json({ message, branch });
    } catch (error) {
      return sendBranchError(res, error, "Unable to change the branch status.");
    }
  });

  router.delete("/branches/:id", async (req, res) => {
    try {
      await clinicBranches.deleteBranch(db, req.params.id);
      return res.status(500).json({ message: "Unable to delete the branch." });
    } catch (error) {
      return sendBranchError(res, error, "Unable to delete the branch.");
    }
  });
}

module.exports = { attachClinicBranchRoutes };
