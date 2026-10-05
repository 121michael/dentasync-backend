"use strict";

/**
 * Canonical patient-data normalization shared by every portal.
 *
 * One patient → one canonical record. These helpers make sure that whatever the
 * source (Admin form, OCR'd document, Dentist treatment form, Staff payment form,
 * Patient profile), values are stored in a single internal format:
 *
 *   sex         → "Male" | "Female" | "Non-binary" | "Prefer to self-describe" | ""
 *   phone       → digits only, PH mobile numbers as 63XXXXXXXXXX
 *   dates       → YYYY-MM-DD
 *   age         → derived from birthdate, never stored separately
 *   money       → numeric (2 decimals)
 *   treatment   → canonical taxonomy label (Root Canal, Dental Filling, …)
 *   statuses    → lower_snake codes
 */

const dentalChartSync = require("./dentalChartSync");

const SEX_VALUES = {
  male: "Male",
  m: "Male",
  lalaki: "Male",
  female: "Female",
  f: "Female",
  babae: "Female",
  "non-binary": "Non-binary",
  nonbinary: "Non-binary",
  "non_binary": "Non-binary",
  "prefer to self-describe": "Prefer to self-describe",
  other: "Prefer to self-describe",
};

const TREATMENT_TYPES = {
  ROOT_CANAL: "Root Canal",
  DENTAL_FILLING: "Dental Filling",
  EXTRACTION: "Extraction",
  CROWN: "Crown",
  BRIDGE: "Bridge",
  SEALANT: "Sealant",
  DENTURE: "Denture",
  CLEANING: "Cleaning / Oral Prophylaxis",
  ORTHODONTIC: "Orthodontic Treatment",
};

const CHART_KEY_TO_TREATMENT = {
  root_canal: TREATMENT_TYPES.ROOT_CANAL,
  filling: TREATMENT_TYPES.DENTAL_FILLING,
  extraction: TREATMENT_TYPES.EXTRACTION,
  crown: TREATMENT_TYPES.CROWN,
  bridge: TREATMENT_TYPES.BRIDGE,
  sealant: TREATMENT_TYPES.SEALANT,
  denture: TREATMENT_TYPES.DENTURE,
  cleaning: TREATMENT_TYPES.CLEANING,
  braces: TREATMENT_TYPES.ORTHODONTIC,
};

const PAYMENT_STATUS = {
  UNPAID: "pending",
  PARTIALLY_PAID: "partially_paid",
  PAID: "paid",
};

const PAYMENT_STATUS_LABELS = {
  pending: "Unpaid",
  partially_paid: "Partially Paid",
  paid: "Paid",
};

const ACCOUNT_STATUS = {
  PENDING: "pending",
  VERIFIED: "verified",
  REJECTED: "rejected",
  INACTIVE: "inactive",
};

const MONTHS = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

/** Surname particles that belong with the family name ("Dela Cruz", "De los Santos"). */
const SURNAME_PARTICLES = new Set([
  "de", "del", "dela", "delos", "delas", "de la", "de los", "de las",
  "san", "santa", "santo", "sta", "sto",
  "van", "von", "da", "di", "du", "la", "le", "mac", "mc", "st",
]);

function stringValue(value, maxLength = 500) {
  if (value == null) return "";
  const normalized = String(value).trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, maxLength) : "";
}

function titleCase(value) {
  return stringValue(value)
    .toLowerCase()
    .split(" ")
    .map((word) =>
      word
        .split("-")
        .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
        .join("-")
    )
    .join(" ");
}

function normalizeSex(value) {
  const raw = stringValue(value, 60).toLowerCase().replace(/[.\s]+$/g, "");
  if (!raw) return "";
  if (SEX_VALUES[raw]) return SEX_VALUES[raw];
  if (/^fe?m/.test(raw)) return "Female";
  if (/^ma?le?$|^m$/.test(raw)) return "Male";
  return titleCase(raw);
}

function normalizePhone(value) {
  if (value == null) return "";
  const digits = String(value).replace(/\D/g, "");
  if (!digits) return "";
  if (/^0\d{10}$/.test(digits)) return `63${digits.slice(1)}`;
  if (/^9\d{9}$/.test(digits)) return `63${digits}`;
  if (/^0063\d{10}$/.test(digits)) return digits.slice(2);
  return digits;
}

function isValidPhone(value) {
  const digits = normalizePhone(value);
  return /^\d{7,15}$/.test(digits);
}

function formatPhoneForDisplay(value) {
  const digits = normalizePhone(value);
  if (/^63\d{10}$/.test(digits)) return `0${digits.slice(2)}`;
  return digits;
}

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function buildIso(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return "";
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return "";
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isIsoDate(iso) ? iso : "";
}

/**
 * Parse common date spellings into YYYY-MM-DD.
 * Accepts ISO, "January 10, 2005", "10 Jan 2005", "Jan. 10 2005", "01/10/2005" (MM/DD/YYYY),
 * "10-01-2005" (DD-MM-YYYY when the first token cannot be a month), Date objects.
 */
function normalizeIsoDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  }
  const raw = stringValue(value, 60).replace(/(\d)(st|nd|rd|th)\b/gi, "$1");
  if (!raw) return "";

  const isoMatch = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (isoMatch) return buildIso(isoMatch[1], isoMatch[2], isoMatch[3]);

  const monthFirst = raw.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (monthFirst && MONTHS[monthFirst[1].toLowerCase()]) {
    return buildIso(monthFirst[3], MONTHS[monthFirst[1].toLowerCase()], monthFirst[2]);
  }

  const dayFirst = raw.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/);
  if (dayFirst && MONTHS[dayFirst[2].toLowerCase()]) {
    return buildIso(dayFirst[3], MONTHS[dayFirst[2].toLowerCase()], dayFirst[1]);
  }

  const numeric = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    // Application convention is MM/DD/YYYY; fall back to DD/MM/YYYY when MM is impossible.
    if (first >= 1 && first <= 12) {
      const iso = buildIso(numeric[3], first, second);
      if (iso) return iso;
    }
    return buildIso(numeric[3], second, first);
  }

  const twoDigitYear = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})$/);
  if (twoDigitYear) {
    const year = Number(twoDigitYear[3]);
    const fullYear = year > Number(String(new Date().getFullYear()).slice(2)) ? 1900 + year : 2000 + year;
    return buildIso(fullYear, twoDigitYear[1], twoDigitYear[2]);
  }

  return "";
}

function ageFromDateOfBirth(value, today = new Date()) {
  const iso = normalizeIsoDate(value);
  if (!iso) return null;
  const dob = new Date(`${iso}T00:00:00.000Z`);
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = today.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < dob.getUTCDate())) {
    age -= 1;
  }
  return age >= 0 && age <= 130 ? age : null;
}

function formatAgeSex(age, sex) {
  const agePart = age != null && age !== "" ? String(age) : "—";
  const sexPart = sex ? String(sex) : "—";
  return `${agePart} / ${sexPart}`;
}

function parseMoney(value) {
  if (value == null || value === "") return 0;
  const amount =
    typeof value === "number"
      ? value
      : Number(String(value).replace(/[₱$,\s]|php/gi, "").trim());
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100) / 100;
}

function paymentStatus(amountCharged, amountPaid) {
  const charged = Number(amountCharged) || 0;
  const paid = Number(amountPaid) || 0;
  if (paid <= 0) return PAYMENT_STATUS.UNPAID;
  if (paid >= charged) return PAYMENT_STATUS.PAID;
  return PAYMENT_STATUS.PARTIALLY_PAID;
}

function paymentSummary(amountCharged, amountPaid) {
  const charged = Number(amountCharged) || 0;
  const paid = Number(amountPaid) || 0;
  return {
    amountCharged: Math.round(charged * 100) / 100,
    amountPaid: Math.round(paid * 100) / 100,
    balance: Math.round((charged - paid) * 100) / 100,
    paymentStatus: paymentStatus(charged, paid),
  };
}

/**
 * Canonical treatment label for the shared taxonomy. Free-text spellings such as
 * "ROOT CANAL", "root canal treatment", "Root-canal" all become "Root Canal".
 * Unknown treatments keep the trimmed, title-cased text the dentist entered.
 */
function canonicalTreatmentName(value) {
  const raw = stringValue(value, 200);
  if (!raw) return "";
  const catalog = dentalChartSync.PROCEDURE_CATALOG.find(
    (item) => item.value.toLowerCase() === raw.toLowerCase()
  );
  if (catalog) return catalog.value;
  const mapped = dentalChartSync.mapTreatmentNameToChart(raw);
  if (mapped && CHART_KEY_TO_TREATMENT[mapped.key]) {
    return CHART_KEY_TO_TREATMENT[mapped.key];
  }
  return raw;
}

function treatmentTypeKey(value) {
  const mapped = dentalChartSync.mapTreatmentNameToChart(value);
  return mapped ? mapped.key : "other";
}

function normalizeAccountStatus({ status, isVerified } = {}) {
  const raw = stringValue(status, 40).toLowerCase();
  if (raw === "rejected") return ACCOUNT_STATUS.REJECTED;
  if (["inactive", "disabled", "suspended", "archived"].includes(raw)) return ACCOUNT_STATUS.INACTIVE;
  if (isVerified && (raw === "" || raw === "active" || raw === "verified")) return ACCOUNT_STATUS.VERIFIED;
  return ACCOUNT_STATUS.PENDING;
}

/**
 * Split a person's name into first / middle / last.
 * Handles "DELA CRUZ, JUAN", "Juan Dela Cruz", "Juan S. Dela Cruz", "Juan Santos Dela Cruz".
 */
function parseFullName(value) {
  const raw = stringValue(value, 200).replace(/\s*,\s*/g, ", ");
  if (!raw) return { firstName: "", middleName: "", lastName: "", fullName: "" };

  let firstName = "";
  let middleName = "";
  let lastName = "";

  if (raw.includes(",")) {
    const [surnamePart, givenPart = ""] = raw.split(",", 2).map((part) => part.trim());
    lastName = titleCase(surnamePart);
    const given = givenPart.split(" ").filter(Boolean);
    if (given.length > 1 && looksLikeMiddle(given[given.length - 1])) {
      middleName = titleCase(given.pop());
    }
    firstName = titleCase(given.join(" "));
  } else {
    const words = raw.split(" ").filter(Boolean);
    if (words.length === 1) {
      firstName = titleCase(words[0]);
    } else {
      // Walk back from the end collecting the surname, absorbing particles ("Dela", "De los").
      const surname = [words.pop()];
      while (words.length > 1) {
        const candidate = words[words.length - 1].toLowerCase().replace(/\.$/, "");
        const twoWord = words.length > 2
          ? `${words[words.length - 2].toLowerCase()} ${candidate}`
          : "";
        if (SURNAME_PARTICLES.has(twoWord)) {
          surname.unshift(words.pop());
          surname.unshift(words.pop());
        } else if (SURNAME_PARTICLES.has(candidate)) {
          surname.unshift(words.pop());
        } else {
          break;
        }
      }
      lastName = titleCase(surname.join(" "));
      if (words.length > 1 && looksLikeMiddle(words[words.length - 1])) {
        middleName = titleCase(words.pop());
      }
      firstName = titleCase(words.join(" "));
    }
  }

  const fullName = [firstName, middleName, lastName].filter(Boolean).join(" ");
  return { firstName, middleName, lastName, fullName };
}

function looksLikeMiddle(word) {
  const cleaned = String(word || "").replace(/\.$/, "");
  if (!cleaned) return false;
  if (cleaned.length === 1) return true; // initial
  return !SURNAME_PARTICLES.has(cleaned.toLowerCase());
}

function composeFullName({ firstName, middleName, lastName } = {}) {
  return [firstName, middleName, lastName].map((part) => stringValue(part, 80)).filter(Boolean).join(" ");
}

module.exports = {
  SEX_VALUES,
  TREATMENT_TYPES,
  PAYMENT_STATUS,
  PAYMENT_STATUS_LABELS,
  ACCOUNT_STATUS,
  stringValue,
  titleCase,
  normalizeSex,
  normalizePhone,
  isValidPhone,
  formatPhoneForDisplay,
  isIsoDate,
  normalizeIsoDate,
  ageFromDateOfBirth,
  formatAgeSex,
  parseMoney,
  paymentStatus,
  paymentSummary,
  canonicalTreatmentName,
  treatmentTypeKey,
  normalizeAccountStatus,
  parseFullName,
  composeFullName,
};
