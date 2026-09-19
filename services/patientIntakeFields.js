"use strict";

/**
 * Document → patient-form field mapping for Admin patient document intake.
 *
 * Every field lives in ONE canonical shape:
 *   { value, confidence, status, source: { documentId, documentName, page } | null }
 *
 *   status: "extracted" | "manual" | "missing"
 *
 * Fields are mapped onto the existing patient model (users / patient_portal_profiles /
 * clinic_patient_records) — no separate OCR patient model is introduced.
 */

const patientData = require("./patientData");
const patientIds = require("./patientIds");

const LOW_CONFIDENCE = 0.85;
const CONFLICT_MIN_CONFIDENCE = 0.45;

/** Intake field → canonical patient column(s). */
const DOCUMENT_FIELD_MAPPING = {
  firstName: { label: "First Name", target: "users.first_name / clinic_patient_records.first_name", required: true },
  middleName: { label: "Middle Name", target: "clinic_patient_records.notes (middle name)", required: false },
  lastName: { label: "Last Name", target: "users.last_name / clinic_patient_records.last_name", required: true },
  dateOfBirth: { label: "Birthdate", target: "patient_portal_profiles.date_of_birth / clinic_patient_records.date_of_birth", required: true },
  sex: { label: "Sex", target: "patient_portal_profiles.gender / clinic_patient_records.gender", required: true },
  phone: { label: "Phone Number", target: "users.phone / clinic_patient_records.phone", required: true },
  email: { label: "Email", target: "users.email / clinic_patient_records.email", required: false },
  address: { label: "Address", target: "patient_portal_profiles.address / clinic_patient_records.address", required: false },
  patientCategory: { label: "Patient Category", target: "users.patient_category / clinic_patient_records.patient_category", required: true },
};

const FIELD_KEYS = Object.keys(DOCUMENT_FIELD_MAPPING);

const METHOD_BASE_CONFIDENCE = [
  { match: /pdf-text|text-layer|pdf/i, confidence: 0.96 },
  { match: /vision|gemini/i, confidence: 0.9 },
  { match: /ocrspace/i, confidence: 0.82 },
  { match: /easyocr/i, confidence: 0.78 },
  { match: /ocr|tesseract/i, confidence: 0.72 },
];

function emptyField() {
  return { value: "", confidence: 0, status: "missing", source: null };
}

function emptyIntakeFields() {
  const fields = {};
  for (const key of FIELD_KEYS) fields[key] = emptyField();
  return fields;
}

function clamp(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function round(value) {
  return Math.round(clamp(value) * 100) / 100;
}

function baseConfidenceForMethod(method, overall) {
  let base = 0.7;
  const text = String(method || "");
  for (const rule of METHOD_BASE_CONFIDENCE) {
    if (rule.match.test(text)) {
      base = rule.confidence;
      break;
    }
  }
  if (Number.isFinite(Number(overall)) && Number(overall) > 0) {
    const normalized = Number(overall) > 1 ? Number(overall) / 100 : Number(overall);
    base = (base + clamp(normalized)) / 2;
  }
  return base;
}

function statusBonus(status) {
  if (status === "detected") return 0.05;
  if (status === "unable_to_read") return -0.35;
  return -0.1;
}

/**
 * Normalize a raw value for a given field into the application's canonical format.
 * Returns { value, valid } — invalid values are kept so Admin can still see/edit them.
 */
function normalizeFieldValue(key, rawValue) {
  const raw = patientData.stringValue(rawValue, 300);
  if (!raw) return { value: "", valid: false };
  switch (key) {
    case "dateOfBirth": {
      const iso = patientData.normalizeIsoDate(raw);
      return { value: iso || raw, valid: Boolean(iso) && iso <= new Date().toISOString().slice(0, 10) };
    }
    case "sex": {
      const sex = patientData.normalizeSex(raw);
      return { value: sex, valid: ["Male", "Female", "Non-binary", "Prefer to self-describe"].includes(sex) };
    }
    case "phone": {
      const phone = patientData.normalizePhone(raw);
      return { value: phone || raw, valid: patientData.isValidPhone(raw) };
    }
    case "email": {
      const email = raw.toLowerCase();
      return { value: email, valid: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) };
    }
    case "patientCategory": {
      const normalized = patientIds.normalizeCategory(raw);
      return { value: normalized, valid: Boolean(normalized) };
    }
    case "firstName":
    case "middleName":
    case "lastName": {
      const value = patientData.titleCase(raw.replace(/[^A-Za-zÑñ'’\-. ]/g, " ")).trim();
      return { value, valid: value.length >= 1 && !/\d/.test(raw) };
    }
    default:
      return { value: raw, valid: raw.length >= 3 };
  }
}

function detectCategoryHints(text) {
  const hay = String(text || "").toLowerCase();
  if (/\bpwd\b|person(s)? with disabilit/.test(hay)) return "pwd";
  if (/senior\s*citizen|\bosca\b/.test(hay)) return "senior";
  if (/pediatric|paediatric|\bchild\b|minor\b/.test(hay)) return "pediatric";
  return "";
}

/**
 * Suggest a patient category from confirmed data. Age alone drives Pediatric/Senior;
 * PWD only from explicit document text. The Admin must still confirm.
 */
function suggestPatientCategory({ dateOfBirth, rawText } = {}) {
  const hint = detectCategoryHints(rawText);
  if (hint === "pwd") return { category: "pwd", reason: "Document mentions PWD." };
  const age = patientData.ageFromDateOfBirth(dateOfBirth);
  if (age != null && age < 18) return { category: "pediatric", reason: `Age ${age} from birthdate.` };
  if (age != null && age >= 60) return { category: "senior", reason: `Age ${age} from birthdate.` };
  if (hint === "senior") return { category: "senior", reason: "Document mentions Senior Citizen." };
  if (hint === "pediatric") return { category: "pediatric", reason: "Document mentions a pediatric patient." };
  return { category: "regular", reason: age != null ? `Age ${age} from birthdate.` : "Default category." };
}

/**
 * Convert the output of documentSyncExtraction.extractDocumentData into intake fields
 * for a single document.
 */
function buildFieldsFromExtraction(extraction, document = {}) {
  const payload = extraction?.payload || {};
  const patient = payload.patient || {};
  const statuses = extraction?.fieldStatuses || {};
  const base = baseConfidenceForMethod(extraction?.method, extraction?.validation?.confidence);
  const source = {
    documentId: document.id ?? null,
    documentName: document.originalName || document.original_name || "",
    page: 1,
  };

  const fields = emptyIntakeFields();

  const name = patientData.parseFullName(
    patient.fullName || [patient.firstName, patient.lastName].filter(Boolean).join(" ")
  );
  if (patient.firstName && patient.lastName && !patient.fullName) {
    name.firstName = patientData.titleCase(patient.firstName);
    name.lastName = patientData.titleCase(patient.lastName);
  }
  const nameConfidence = base + statusBonus(statuses.fullName);

  assign(fields, "firstName", name.firstName, nameConfidence, source);
  assign(fields, "middleName", name.middleName, nameConfidence - 0.1, source);
  assign(fields, "lastName", name.lastName, nameConfidence, source);
  assign(fields, "dateOfBirth", patient.dateOfBirth, base + statusBonus(statuses.dateOfBirth), source);
  assign(fields, "sex", patient.gender, base + statusBonus(statuses.gender) + 0.05, source);
  assign(fields, "phone", patient.phone, base + statusBonus(statuses.phone), source);
  assign(fields, "email", patient.email, base + statusBonus(statuses.email), source);
  assign(fields, "address", patient.address, base + statusBonus(statuses.address) - 0.12, source);

  const hint = detectCategoryHints(extraction?.rawText);
  if (hint) assign(fields, "patientCategory", hint, base - 0.2, source);

  return fields;
}

function assign(fields, key, rawValue, confidence, source) {
  const { value, valid } = normalizeFieldValue(key, rawValue);
  if (!value) {
    fields[key] = emptyField();
    return;
  }
  fields[key] = {
    value,
    confidence: round(valid ? confidence : confidence - 0.3),
    status: "extracted",
    source,
  };
}

function sameValue(key, a, b) {
  const left = normalizeFieldValue(key, a).value.toLowerCase();
  const right = normalizeFieldValue(key, b).value.toLowerCase();
  return left === right;
}

/**
 * Merge the per-document fields of every processed document with the Admin's manual
 * edits. Highest confidence wins; a lower-confidence value from another document never
 * overwrites a valid one. Differing values with meaningful confidence are reported as
 * conflicts for Admin review instead of being silently resolved.
 *
 * @param {Array<{id, originalName, fields}>} documents
 * @param {Object} manualFields  fields with status "manual" (Admin edits) win outright
 */
function mergeDocumentFields(documents = [], manualFields = {}) {
  const merged = emptyIntakeFields();
  const conflicts = [];

  for (const key of FIELD_KEYS) {
    const manual = manualFields?.[key];
    if (manual && manual.status === "manual" && patientData.stringValue(manual.value)) {
      merged[key] = { ...manual, confidence: 1, source: manual.source || null };
      continue;
    }

    const candidates = [];
    for (const doc of documents) {
      const field = doc?.fields?.[key];
      if (!field || !patientData.stringValue(field.value)) continue;
      candidates.push({
        value: field.value,
        confidence: clamp(field.confidence),
        documentId: doc.id ?? field.source?.documentId ?? null,
        documentName: doc.originalName || field.source?.documentName || "",
        page: field.source?.page || 1,
      });
    }
    if (!candidates.length) {
      merged[key] = manual && patientData.stringValue(manual.value) ? manual : emptyField();
      continue;
    }

    candidates.sort((a, b) => b.confidence - a.confidence);
    const best = candidates[0];
    merged[key] = {
      value: best.value,
      confidence: round(best.confidence),
      status: "extracted",
      source: { documentId: best.documentId, documentName: best.documentName, page: best.page },
    };

    const differing = candidates.filter(
      (candidate) => candidate.confidence >= CONFLICT_MIN_CONFIDENCE && !sameValue(key, candidate.value, best.value)
    );
    if (differing.length) {
      const options = [best, ...differing].filter(
        (option, index, list) => list.findIndex((other) => sameValue(key, other.value, option.value)) === index
      );
      conflicts.push({
        field: key,
        label: DOCUMENT_FIELD_MAPPING[key].label,
        options: options.map((option) => ({
          value: option.value,
          confidence: round(option.confidence),
          documentId: option.documentId,
          documentName: option.documentName,
        })),
      });
    }
  }

  return { fields: merged, conflicts };
}

/**
 * Validate merged fields against the existing patient-registration rules.
 * Returns { valid, missing: [key], invalid: [{key, message}], lowConfidence: [key] }.
 */
function validateIntakeFields(fields, { categoryConfirmed = false } = {}) {
  const missing = [];
  const invalid = [];
  const lowConfidence = [];

  for (const key of FIELD_KEYS) {
    const mapping = DOCUMENT_FIELD_MAPPING[key];
    const field = fields?.[key] || emptyField();
    const value = patientData.stringValue(field.value);

    if (!value) {
      if (mapping.required) missing.push(key);
      continue;
    }
    const { valid } = normalizeFieldValue(key, value);
    if (!valid) {
      invalid.push({ key, message: invalidMessage(key) });
    }
    if (field.status === "extracted" && clamp(field.confidence) < LOW_CONFIDENCE) {
      lowConfidence.push(key);
    }
  }

  if (!categoryConfirmed && !missing.includes("patientCategory")) {
    invalid.push({ key: "patientCategory", message: "Confirm the patient category before saving." });
  }

  return {
    valid: !missing.length && !invalid.length,
    missing,
    invalid,
    lowConfidence,
    requiredFields: FIELD_KEYS.filter((key) => DOCUMENT_FIELD_MAPPING[key].required),
  };
}

function invalidMessage(key) {
  switch (key) {
    case "dateOfBirth":
      return "Birthdate must be a valid past date (YYYY-MM-DD).";
    case "sex":
      return "Sex must be Male, Female, Non-binary, or Prefer to self-describe.";
    case "phone":
      return "Phone number must contain 7–15 digits.";
    case "email":
      return "Email address is not valid.";
    case "firstName":
    case "lastName":
    case "middleName":
      return "Names may only contain letters, spaces, hyphens, and apostrophes.";
    default:
      return "Value is not valid.";
  }
}

/**
 * Apply Admin edits. Every edited field becomes status "manual" (confidence 1) so it
 * wins over any document value and clears conflicts for that field.
 */
function applyManualEdits(currentFields, edits = {}) {
  const next = { ...emptyIntakeFields(), ...(currentFields || {}) };
  for (const key of FIELD_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(edits, key)) continue;
    const raw = edits[key];
    const value = normalizeFieldValue(key, raw).value;
    if (!patientData.stringValue(raw)) {
      next[key] = emptyField();
      continue;
    }
    const unchanged = next[key] && next[key].status === "extracted" && sameValue(key, next[key].value, value);
    next[key] = unchanged
      ? { ...next[key], value }
      : { value, confidence: 1, status: "manual", source: next[key]?.source || null };
  }
  return next;
}

/** Plain { key: value } view of the merged fields for forms and record creation. */
function fieldValues(fields) {
  const values = {};
  for (const key of FIELD_KEYS) values[key] = patientData.stringValue(fields?.[key]?.value);
  return values;
}

/** Map confirmed intake values onto the canonical clinical record input. */
function toClinicalRecordInput(fields) {
  const values = fieldValues(fields);
  const notes = [];
  if (values.middleName) notes.push(`Middle name: ${values.middleName}`);
  notes.push("Created via Admin patient document intake");
  return {
    firstName: values.firstName,
    lastName: values.lastName,
    email: values.email || null,
    phone: values.phone || null,
    dateOfBirth: values.dateOfBirth || null,
    gender: values.sex || null,
    address: values.address || null,
    patientCategory: values.patientCategory || "regular",
    notes: notes.join(". "),
  };
}

module.exports = {
  DOCUMENT_FIELD_MAPPING,
  FIELD_KEYS,
  LOW_CONFIDENCE,
  emptyField,
  emptyIntakeFields,
  normalizeFieldValue,
  suggestPatientCategory,
  detectCategoryHints,
  buildFieldsFromExtraction,
  mergeDocumentFields,
  validateIntakeFields,
  applyManualEdits,
  fieldValues,
  toClinicalRecordInput,
};
