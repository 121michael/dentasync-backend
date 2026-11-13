"use strict";

const fs = require("fs");
const path = require("path");

const BRANCH_HEADER = "x-dentasync-branch";

function accessError(message, status = 403) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function mapBranch(row) {
  return {
    id: row.id,
    branchId: row.branch_code,
    name: row.name,
    status: row.status,
    isMain: Boolean(row.is_main),
    active: row.status === "active",
  };
}

function publicContext(context) {
  const active = context?.activeBranch || null;
  return {
    branch: active,
    branches: context?.assignments || [],
    activeBranches: (context?.assignments || []).filter((branch) => branch.active),
    operational: Boolean(active),
    requiresSelection: Boolean(context?.requiresSelection),
    message: context?.message || null,
  };
}

async function applyBranchOperationSchema(db) {
  const sqlPath = path.join(__dirname, "..", "migrations", "053_branch_operations.sql");
  await db.query(fs.readFileSync(sqlPath, "utf8"));
}

async function rollbackBranchOperationSchema(db) {
  const sqlPath = path.join(__dirname, "..", "migrations", "053_branch_operations_rollback.sql");
  await db.query(fs.readFileSync(sqlPath, "utf8"));
}

async function listAssignments(db, userId) {
  const result = await db.query(
    `SELECT branch.id, branch.branch_code, branch.name, branch.status, branch.is_main
     FROM clinic_branch_assignments AS assignment
     JOIN clinic_branches AS branch ON branch.id = assignment.branch_id
     WHERE assignment.user_id::text = $1
     ORDER BY branch.is_main DESC, branch.name ASC, branch.id ASC`,
    [String(userId)]
  );
  return result.rows.map(mapBranch);
}

async function mainBranchId(db) {
  try {
    const result = await db.query(
      `SELECT id FROM clinic_branches WHERE is_main ORDER BY id LIMIT 1`
    );
    return result.rows[0]?.id || null;
  } catch (error) {
    if (error.code === "42P01") return null;
    throw error;
  }
}

async function resolveForAccount(db, { userId, role, requestedBranchId }) {
  let assignments = [];
  try {
    assignments = await listAssignments(db, userId);
  } catch (error) {
    if (error.code === "42P01" || /Unexpected test query/i.test(String(error.message || ""))) {
      return {
        legacy: true,
        assignments: [],
        activeBranch: null,
        message: null,
      };
    }
    throw error;
  }

  const requested = requestedBranchId
    ? assignments.find((branch) => String(branch.id) === String(requestedBranchId))
    : null;
  if (requestedBranchId && !requested) {
    return {
      assignments,
      activeBranch: null,
      forbidden: true,
      message: "You are not assigned to that branch.",
    };
  }

  if (role === "staff") {
    const branch = assignments[0] || null;
    if (!branch) {
      return {
        assignments,
        activeBranch: null,
        message: "No branch is assigned to this account. Ask an administrator to assign a branch.",
      };
    }
    if (!branch.active) {
      return {
        assignments,
        activeBranch: null,
        branch,
        message: `${branch.name} is inactive. New check-ins, appointments, and queue updates are paused.`,
      };
    }
    return { assignments, activeBranch: branch, branch, message: null };
  }

  const active = assignments.filter((branch) => branch.active);
  if (requested && !requested.active) {
    return {
      assignments,
      activeBranch: null,
      branch: requested,
      requiresSelection: active.length > 1,
      message: `${requested.name} is inactive. New appointments and queue updates are paused for that branch.`,
    };
  }
  const chosen = requested || active[0] || null;
  if (!chosen) {
    return {
      assignments,
      activeBranch: null,
      message: assignments.length
        ? "Every assigned branch is inactive. An administrator can reactivate one."
        : "No branch is assigned to this account. Ask an administrator to assign a branch.",
    };
  }
  return {
    assignments,
    activeBranch: chosen,
    branch: chosen,
    requiresSelection: active.length > 1,
    message: null,
  };
}

function requestedBranchId(req) {
  const header = req.get(BRANCH_HEADER);
  const query = req.query?.branchId;
  const body = req.body?.branchId;
  const value = header || query || (req.method === "GET" ? null : body);
  if (value == null || value === "") return null;
  return String(value);
}

function attachBranchAccess(db, role) {
  return async (req, res, next) => {
    try {
      const userId = role === "staff" ? req.staff?.id : req.dentist?.id;
      req.branchAccess = await resolveForAccount(db, {
        userId,
        role,
        requestedBranchId: requestedBranchId(req),
      });
      if (req.branchAccess.legacy) {
        return next();
      }
      if (req.branchAccess.forbidden) {
        return res.status(403).json({ message: req.branchAccess.message });
      }
      const path = req.path || "";
      const reading = req.method === "GET" || req.method === "HEAD";
      const profileOrNotice = path.startsWith("/profile") || path.startsWith("/notifications") || path.startsWith("/branch-context");
      const clinicalRead = reading && path.startsWith("/patients");
      if (!req.branchAccess.activeBranch && !reading && !profileOrNotice && !clinicalRead) {
        return res.status(409).json({
          message: req.branchAccess.message,
          branch: publicContext(req.branchAccess),
        });
      }
      return next();
    } catch (error) {
      if (error.status) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("Branch access error:", error.message);
      return res.status(500).json({ message: "Unable to identify the assigned branch." });
    }
  };
}

function closedBranchResponse(req, res, body) {
  if (req.branchAccess?.activeBranch) return false;
  res.status(200).json({
    message: req.branchAccess?.message || "No active branch is available for this account.",
    branch: publicContext(req.branchAccess),
    ...body,
  });
  return true;
}

module.exports = {
  BRANCH_HEADER,
  accessError,
  publicContext,
  applyBranchOperationSchema,
  rollbackBranchOperationSchema,
  listAssignments,
  mainBranchId,
  resolveForAccount,
  requestedBranchId,
  attachBranchAccess,
  closedBranchResponse,
};
