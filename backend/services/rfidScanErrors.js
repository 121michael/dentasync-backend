"use strict";

const { NO_WALK_IN_SLOTS_MESSAGE } = require("./patientBranchBooking");

const RFID_UNASSIGNED_MESSAGE =
  "RFID card is not assigned to a patient. Please ask an administrator to register this card.";
const RFID_INACTIVE_MESSAGE = "This RFID card is assigned to an inactive patient account.";
const RFID_READER_UNCONFIGURED_MESSAGE = "RFID reader is not configured for a clinic branch.";
const RFID_READER_DISABLED_MESSAGE = "RFID check-in is turned off for this clinic branch.";
const RFID_READER_CONNECTION_MESSAGE = "RFID reader connection failed.";

const RFID_ERROR_CODES = {
  UNASSIGNED: "RFID_UNASSIGNED",
  INACTIVE: "RFID_INACTIVE",
  WRONG_BRANCH: "RFID_WRONG_BRANCH",
  NO_WALK_IN_SLOT: "RFID_NO_WALK_IN_SLOT",
  READER_UNCONFIGURED: "RFID_READER_UNCONFIGURED",
  READER_DISABLED: "RFID_READER_DISABLED",
  READER_CONNECTION: "RFID_READER_CONNECTION",
};

function isInactivePatientStatus(patient) {
  if (!patient) return false;
  if (patient.is_archived) return true;
  const status = String(patient.status || "active").trim().toLowerCase();
  return ["inactive", "disabled", "suspended", "deactivated"].includes(status);
}

function classifyCheckInError(error) {
  if (!error) return null;
  if (error.errorCode) return error.errorCode;
  if (error.code === "SETUP_REQUIRED") return "SETUP_REQUIRED";
  if (error.message === NO_WALK_IN_SLOTS_MESSAGE) return RFID_ERROR_CODES.NO_WALK_IN_SLOT;
  if (/staffed desk|another clinic branch/i.test(String(error.message || ""))) {
    return RFID_ERROR_CODES.WRONG_BRANCH;
  }
  if (error.message === RFID_READER_UNCONFIGURED_MESSAGE) return RFID_ERROR_CODES.READER_UNCONFIGURED;
  if (error.message === RFID_READER_DISABLED_MESSAGE) return RFID_ERROR_CODES.READER_DISABLED;
  return null;
}

function patientSummary(patient) {
  if (!patient) return null;
  return {
    id: patient.id,
    fullName: `${patient.first_name || ""} ${patient.last_name || ""}`.trim() || "Patient",
    phone: patient.phone || null,
    email: patient.email || null,
  };
}

module.exports = {
  NO_WALK_IN_SLOTS_MESSAGE,
  RFID_UNASSIGNED_MESSAGE,
  RFID_INACTIVE_MESSAGE,
  RFID_READER_UNCONFIGURED_MESSAGE,
  RFID_READER_DISABLED_MESSAGE,
  RFID_READER_CONNECTION_MESSAGE,
  RFID_ERROR_CODES,
  isInactivePatientStatus,
  classifyCheckInError,
  patientSummary,
};
