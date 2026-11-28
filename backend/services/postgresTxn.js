"use strict";

function columnFromUndefined(error) {
  return String(error?.message || "").match(/column "([^"]+)"/i)?.[1] || "";
}

function relationFromMissing(error) {
  return String(error?.message || "").match(/relation "([^"]+)"/i)?.[1] || "";
}

const SCHEMA_HINTS = {
  visit_origin: "066_appointment_visit_origin.sql",
  staff_walkin_qr_sessions: "016_staff_walkin_qr.sql",
  staff_walkin_qr_redemptions: "016_staff_walkin_qr.sql",
  clinic_rfid_readers: "055_branch_check_in.sql",
  patient_portal_queue_entries: "002_create_patient_portal.sql",
};

const STAFF_SETUP_UNAVAILABLE_MESSAGE =
  "Check-in is temporarily unavailable. Contact an administrator to complete setup.";

function setupRequiredError(migration, original) {
  const error = new Error(STAFF_SETUP_UNAVAILABLE_MESSAGE);
  error.status = 503;
  error.code = "SETUP_REQUIRED";
  error.migration = migration;
  error.adminMessage = `Apply backend/migrations/${migration} and retry.`;
  error.originalCode = original?.code;
  error.originalMessage = original?.message;
  return error;
}

function schemaError(error) {
  if (!error) return null;
  if (error.code === "SETUP_REQUIRED") return error;
  if (error.code === "42P01") {
    const relation = relationFromMissing(error);
    const migration = SCHEMA_HINTS[relation];
    if (migration) return setupRequiredError(migration, error);
  }
  if (error.code === "42703") {
    const column = columnFromUndefined(error);
    const migration = SCHEMA_HINTS[column];
    if (migration) return setupRequiredError(migration, error);
  }
  return null;
}

function isRawSqlMessage(text) {
  const msg = String(text || "");
  return (
    /current transaction is aborted/i.test(msg) ||
    /commands ignored until end of transaction/i.test(msg) ||
    /column ".*" does not exist/i.test(msg) ||
    /relation ".*" does not exist/i.test(msg) ||
    /duplicate key value/i.test(msg) ||
    /violates .+ constraint/i.test(msg)
  );
}

function publicCheckInMessage(error, fallback = "Unable to complete patient check-in. Try again.") {
  if (!error) return fallback;
  const mapped = schemaError(error);
  if (mapped) return STAFF_SETUP_UNAVAILABLE_MESSAGE;
  if (String(error.message || "").includes("estimated_cost")) {
    return "Unable to create walk-in appointment for check-in.";
  }
  if (error.status && error.status < 500 && !isRawSqlMessage(error.message)) {
    return error.message;
  }
  return fallback;
}

function checkInFailureResponse(error) {
  const mapped = schemaError(error);
  const publicError = mapped || error;
  const errorCode =
    publicError.code === "SETUP_REQUIRED"
      ? "SETUP_REQUIRED"
      : publicError.errorCode || null;
  return {
    status: publicError.status || 500,
    message: publicCheckInMessage(publicError),
    errorCode: errorCode || undefined,
    code: publicError.code === "SETUP_REQUIRED" ? "SETUP_REQUIRED" : undefined,
  };
}

function logCheckInFailure(scope, error) {
  const mapped = schemaError(error);
  console.error(
    `${scope}:`,
    error?.code || "",
    mapped?.migration || error?.migration || "",
    mapped?.adminMessage || error?.adminMessage || "",
    error?.originalCode || columnFromUndefined(error) || relationFromMissing(error) || "",
    error?.originalMessage || error?.message || ""
  );
}

async function withSavepoint(client, name, fn) {
  const savepoint = String(name || "sp").replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 60);
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    const result = await fn();
    try {
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    } catch {
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    }
    return result;
  } catch (error) {
    try {
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    } catch (rollbackError) {
      error.savepointRollbackError = rollbackError.message;
    }
    throw error;
  }
}

async function safeRollback(client) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Idle or already rolled back.
  }
}

module.exports = {
  withSavepoint,
  safeRollback,
  schemaError,
  setupRequiredError,
  publicCheckInMessage,
  checkInFailureResponse,
  isRawSqlMessage,
  logCheckInFailure,
  STAFF_SETUP_UNAVAILABLE_MESSAGE,
};
