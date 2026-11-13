"use strict";

const fs = require("fs");
const path = require("path");

const MAIN_BRANCH_CODE = "BR-0001";

function assignmentError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function missingDetails(row) {
  const missing = [];
  if (!String(row.address || "").trim()) missing.push("address");
  if (!String(row.contact_number || "").trim()) missing.push("contact number");
  if (!String(row.email || "").trim()) missing.push("email");
  return missing;
}

function mapBranch(row, extras = {}) {
  return {
    id: row.id,
    branchId: row.branch_code,
    name: row.name,
    address: row.address || "",
    contactNumber: row.contact_number || "",
    email: row.email || "",
    isMain: Boolean(row.is_main),
    status: row.status,
    createdAt: row.created_at,
    missingDetails: missingDetails(row),
    personnel: extras.personnel || undefined,
  };
}

function mapAssignment(row) {
  return {
    id: row.branch_id,
    branchId: row.branch_code,
    name: row.name,
    status: row.status,
    isMain: Boolean(row.is_main),
    inactive: row.status !== "active",
  };
}

function assignmentRequested(body) {
  return Boolean(body) && (Object.prototype.hasOwnProperty.call(body, "branchId") || Object.prototype.hasOwnProperty.call(body, "branchIds"));
}

function readRequestedBranchIds(body, role) {
  const hasBranchIds = Object.prototype.hasOwnProperty.call(body || {}, "branchIds");
  const hasBranchId = Object.prototype.hasOwnProperty.call(body || {}, "branchId");
  let ids = [];
  if (hasBranchIds) {
    if (!Array.isArray(body.branchIds)) {
      throw assignmentError("Branch assignments must be a list of branch IDs.");
    }
    ids = body.branchIds;
  } else if (hasBranchId) {
    ids = body.branchId == null || body.branchId === "" ? [] : [body.branchId];
  }
  ids = [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))];
  if (role === "staff" && ids.length !== 1) {
    throw assignmentError("Staff must be assigned to exactly one branch.");
  }
  if (role === "dentist" && ids.length < 1) {
    throw assignmentError("Dentists must be assigned to at least one branch.");
  }
  if (role !== "staff" && role !== "dentist") {
    throw assignmentError("Only staff and dentists can be assigned to a branch.");
  }
  return ids;
}

async function applyClinicBranchSchema(db) {
  const sqlPath = path.join(__dirname, "..", "migrations", "052_clinic_branches.sql");
  await db.query(fs.readFileSync(sqlPath, "utf8"));
}

async function rollbackClinicBranchSchema(db) {
  const sqlPath = path.join(__dirname, "..", "migrations", "052_clinic_branches_rollback.sql");
  await db.query(fs.readFileSync(sqlPath, "utf8"));
}

async function listBranches(db, { search = "", status = "" } = {}) {
  const params = [];
  const clauses = [];
  if (search) {
    params.push(`%${search}%`);
    clauses.push(`(
      branch.branch_code ILIKE $${params.length}
      OR branch.name ILIKE $${params.length}
      OR branch.address ILIKE $${params.length}
      OR branch.contact_number ILIKE $${params.length}
      OR COALESCE(branch.email, '') ILIKE $${params.length}
    )`);
  }
  if (status === "active" || status === "inactive") {
    params.push(status);
    clauses.push(`branch.status = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await db.query(
    `SELECT * FROM clinic_branches AS branch
     ${where}
     ORDER BY branch.is_main DESC, branch.name ASC, branch.id ASC`,
    params
  );
  return result.rows.map((row) => mapBranch(row));
}

async function getBranch(db, id) {
  const result = await db.query("SELECT * FROM clinic_branches WHERE id::text = $1 LIMIT 1", [String(id)]);
  if (!result.rows.length) return null;
  const personnel = await db.query(
    `SELECT account.id, account.first_name, account.last_name, account.email, account.role, account.status
     FROM clinic_branch_assignments AS assignment
     JOIN users AS account ON account.id = assignment.user_id
     WHERE assignment.branch_id = $1
     ORDER BY account.role ASC, account.last_name ASC, account.first_name ASC`,
    [result.rows[0].id]
  );
  return mapBranch(result.rows[0], {
    personnel: personnel.rows.map((row) => ({
      id: row.id,
      fullName: `${row.first_name || ""} ${row.last_name || ""}`.trim(),
      email: row.email || "",
      role: String(row.role || "").toLowerCase(),
      accountStatus: String(row.status || "").toLowerCase(),
      assignmentLabel: result.rows[0].status === "active" ? "Active branch" : "Inactive branch",
    })),
  });
}

function cleanBranchInput(input = {}, { creating = false } = {}) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const address = typeof input.address === "string" ? input.address.trim() : "";
  const contactNumber = typeof input.contactNumber === "string" ? input.contactNumber.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim() : "";
  if (!name) throw assignmentError("Branch name is required.");
  if (!address) throw assignmentError("Branch address is required.");
  if (!contactNumber) throw assignmentError("Branch contact number is required.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw assignmentError("Enter a valid branch email address or leave it blank.");
  }
  if (Object.prototype.hasOwnProperty.call(input, "isMain")) {
    throw assignmentError("The Main Branch designation cannot be changed.", 409);
  }
  const status = String(input.status || (creating ? "active" : "")).toLowerCase();
  if (status && !["active", "inactive"].includes(status)) {
    throw assignmentError("Branch status must be active or inactive.");
  }
  return {
    name: name.slice(0, 120),
    address: address.slice(0, 500),
    contactNumber: contactNumber.slice(0, 40),
    email: email ? email.slice(0, 254) : null,
    status: status || null,
  };
}

async function nextBranchCode(db) {
  const result = await db.query(
    `SELECT branch_code FROM clinic_branches WHERE branch_code ~ '^BR-[0-9]+$' ORDER BY branch_code DESC LIMIT 1`
  );
  const current = result.rows[0]?.branch_code || "BR-0000";
  const next = Number(current.slice(3)) + 1;
  return `BR-${String(next).padStart(4, "0")}`;
}

async function createBranch(db, input) {
  const fields = cleanBranchInput(input, { creating: true });
  const code = await nextBranchCode(db);
  const result = await db.query(
    `INSERT INTO clinic_branches (branch_code, name, address, contact_number, email, is_main, status)
     VALUES ($1, $2, $3, $4, $5, FALSE, $6)
     RETURNING *`,
    [code, fields.name, fields.address, fields.contactNumber, fields.email, fields.status || "active"]
  );
  return mapBranch(result.rows[0]);
}

async function updateBranch(db, id, input) {
  const current = await db.query("SELECT * FROM clinic_branches WHERE id::text = $1", [String(id)]);
  if (!current.rows.length) throw assignmentError("Branch not found.", 404);
  const row = current.rows[0];
  const payload = {
    name: input.name != null ? input.name : row.name,
    address: input.address != null ? input.address : row.address,
    contactNumber: input.contactNumber != null ? input.contactNumber : row.contact_number,
    email: input.email != null ? input.email : row.email || "",
    status: input.status != null ? input.status : row.status,
  };
  if (Object.prototype.hasOwnProperty.call(input, "isMain")) {
    payload.isMain = input.isMain;
  }
  const fields = cleanBranchInput(payload);
  if (row.is_main && fields.status === "inactive") {
    throw assignmentError("The Main Branch cannot be deactivated.", 409);
  }
  const result = await db.query(
    `UPDATE clinic_branches
     SET name = $2, address = $3, contact_number = $4, email = $5, status = $6
     WHERE id = $1
     RETURNING *`,
    [row.id, fields.name, fields.address, fields.contactNumber, fields.email, fields.status || row.status]
  );
  return mapBranch(result.rows[0]);
}

async function setBranchStatus(db, id, status) {
  const normalized = String(status || "").toLowerCase();
  if (!["active", "inactive"].includes(normalized)) {
    throw assignmentError("Branch status must be active or inactive.");
  }
  const current = await db.query("SELECT * FROM clinic_branches WHERE id::text = $1", [String(id)]);
  if (!current.rows.length) throw assignmentError("Branch not found.", 404);
  if (current.rows[0].is_main && normalized !== "active") {
    throw assignmentError("The Main Branch cannot be deactivated.", 409);
  }
  const result = await db.query(
    `UPDATE clinic_branches SET status = $2 WHERE id = $1 RETURNING *`,
    [current.rows[0].id, normalized]
  );
  return mapBranch(result.rows[0]);
}

async function deleteBranch(db, id) {
  const current = await db.query("SELECT * FROM clinic_branches WHERE id::text = $1", [String(id)]);
  if (!current.rows.length) throw assignmentError("Branch not found.", 404);
  if (current.rows[0].is_main) {
    throw assignmentError("The Main Branch cannot be deleted.", 403);
  }
  throw assignmentError("Deactivate the branch instead of deleting it. Existing assignments are kept.", 409);
}

async function replacePersonnelAssignments(client, { userId, role, branchIds }) {
  const ids = branchIds.map((id) => String(id));
  const branches = await client.query(
    `SELECT id, status FROM clinic_branches WHERE id::text = ANY($1::text[])`,
    [ids]
  );
  if (branches.rows.length !== ids.length) {
    throw assignmentError("One or more branch IDs are not valid.");
  }
  const existing = await client.query(
    `SELECT id, branch_id::text AS branch_id FROM clinic_branch_assignments WHERE user_id::text = $1`,
    [String(userId)]
  );
  const existingIds = new Set(existing.rows.map((row) => row.branch_id));
  for (const branch of branches.rows) {
    if (branch.status !== "active" && !existingIds.has(String(branch.id))) {
      throw assignmentError("New assignments require an active branch.");
    }
  }
  await client.query(
    `DELETE FROM clinic_branch_assignments
     WHERE user_id::text = $1
       AND NOT (branch_id::text = ANY($2::text[]))`,
    [String(userId), ids]
  );
  for (const branchId of ids) {
    if (existingIds.has(String(branchId))) continue;
    await client.query(
      `INSERT INTO clinic_branch_assignments (user_id, branch_id) VALUES ($1, $2)`,
      [userId, branchId]
    );
  }
}

async function attachAssignments(db, accounts) {
  if (!accounts.length) return accounts;
  try {
    const result = await db.query(
      `SELECT assignment.user_id::text AS user_id, branch.id AS branch_id, branch.branch_code, branch.name, branch.status, branch.is_main
       FROM clinic_branch_assignments AS assignment
       JOIN clinic_branches AS branch ON branch.id = assignment.branch_id
       WHERE assignment.user_id::text = ANY($1::text[])
       ORDER BY branch.is_main DESC, branch.name ASC`,
      [accounts.map((account) => String(account.id))]
    );
    const byUser = new Map();
    for (const row of result.rows) {
      const list = byUser.get(row.user_id) || [];
      list.push(mapAssignment(row));
      byUser.set(row.user_id, list);
    }
    for (const account of accounts) {
      account.branches = byUser.get(String(account.id)) || [];
    }
  } catch (error) {
    if (error?.code !== "42P01") throw error;
  }
  return accounts;
}

module.exports = {
  MAIN_BRANCH_CODE,
  assignmentError,
  assignmentRequested,
  readRequestedBranchIds,
  applyClinicBranchSchema,
  rollbackClinicBranchSchema,
  listBranches,
  getBranch,
  createBranch,
  updateBranch,
  setBranchStatus,
  deleteBranch,
  replacePersonnelAssignments,
  attachAssignments,
  mapBranch,
};
