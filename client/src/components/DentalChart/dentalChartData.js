/** FDI adult permanent dentition — visual order matches standard dental chart reference. */

export const UPPER_TEETH = [
  18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28,
];

export const LOWER_TEETH = [
  48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38,
];

export const ALL_TEETH = [...UPPER_TEETH, ...LOWER_TEETH];

/** FDI primary (pediatric) dentition — same straight-line layout, five teeth per side. */
export const PRIMARY_UPPER_TEETH = [55, 54, 53, 52, 51, 61, 62, 63, 64, 65];

export const PRIMARY_LOWER_TEETH = [85, 84, 83, 82, 81, 71, 72, 73, 74, 75];

export const ALL_PRIMARY_TEETH = [...PRIMARY_UPPER_TEETH, ...PRIMARY_LOWER_TEETH];

export const EVERY_TOOTH = [...ALL_TEETH, ...ALL_PRIMARY_TEETH];

export function isPrimaryTooth(toothNumber) {
  return ALL_PRIMARY_TEETH.includes(Number(toothNumber));
}

export function teethForDentition(dentition) {
  return dentition === "primary"
    ? { upper: PRIMARY_UPPER_TEETH, lower: PRIMARY_LOWER_TEETH, all: ALL_PRIMARY_TEETH }
    : { upper: UPPER_TEETH, lower: LOWER_TEETH, all: ALL_TEETH };
}

/** Pediatric patients (category P, or young children) default to the primary chart. */
export function dentitionForPatient({ category, age } = {}) {
  const normalized = String(category || "").trim().toLowerCase();
  if (normalized === "p" || normalized.includes("pedia") || normalized.includes("child")) {
    return "primary";
  }
  const numericAge = Number(age);
  if (Number.isFinite(numericAge) && numericAge > 0 && numericAge <= 6) return "primary";
  return "permanent";
}

export const CONDITION_OPTIONS = [
  { value: "healthy", label: "Healthy" },
  { value: "decay", label: "Decay" },
  { value: "caries", label: "Caries" },
  { value: "missing", label: "Missing" },
  { value: "fractured", label: "Fractured" },
  { value: "impacted", label: "Impacted" },
  { value: "sensitive", label: "Sensitive" },
  { value: "root_canal", label: "Root Canal" },
  { value: "filling", label: "Restored / Filled" },
  { value: "crown", label: "Crown" },
  { value: "bridge", label: "Bridge" },
  { value: "other", label: "Other" },
];

export const TREATMENT_OPTIONS = [
  { value: "filling", label: "Dental Filling / Tooth Restoration" },
  { value: "extraction", label: "Extraction" },
  { value: "cleaning", label: "Cleaning / Oral Prophylaxis" },
  { value: "root_canal", label: "Root Canal" },
  { value: "crown", label: "Crown" },
  { value: "bridge", label: "Bridge" },
  { value: "denture", label: "Denture" },
  { value: "sealant", label: "Sealant" },
  { value: "braces", label: "Braces / Orthodontic Treatment" },
  { value: "other", label: "Other" },
];

/** Procedure choices for the Add Treatment form (labels match backend catalog). */
export const PROCEDURE_FORM_OPTIONS = [
  { value: "Root Canal", toothSpecific: true },
  { value: "Dental Filling", toothSpecific: true },
  { value: "Tooth Restoration", toothSpecific: true },
  { value: "Extraction", toothSpecific: true },
  { value: "Crown", toothSpecific: true },
  { value: "Bridge", toothSpecific: true },
  { value: "Sealant", toothSpecific: true },
  { value: "Cleaning / Oral Prophylaxis", toothSpecific: false },
  { value: "Orthodontic Treatment", toothSpecific: false },
  { value: "Denture", toothSpecific: true },
  { value: "Other", toothSpecific: false },
];

export const STATUS_OPTIONS = [
  { value: "healthy", label: "Healthy" },
  { value: "needs_attention", label: "Needs Attention" },
  { value: "under_treatment", label: "Under Treatment" },
  { value: "treated", label: "Treated" },
  { value: "missing", label: "Missing / Extracted" },
];

export function emptyToothRecord(toothNumber) {
  return {
    toothNumber: String(toothNumber),
    condition: [],
    treatments: [],
    notes: "",
    status: "healthy",
    conditionLabel: "healthy",
    updatedAt: null,
    updatedBy: null,
    createdAt: null,
    createdBy: null,
  };
}

export function buildDefaultChart(teeth = EVERY_TOOTH) {
  const chart = {};
  for (const tooth of teeth) {
    chart[String(tooth)] = emptyToothRecord(tooth);
  }
  return chart;
}

export function normalizeChartEntry(entry = {}) {
  const toothNumber = String(entry.toothNumber || entry.tooth_number || "");
  const conditions = Array.isArray(entry.conditions)
    ? entry.conditions
    : Array.isArray(entry.condition)
      ? entry.condition
      : entry.conditionLabel || entry.condition_label
        ? [entry.conditionLabel || entry.condition_label]
        : [];
  const treatments = Array.isArray(entry.treatments)
    ? entry.treatments
    : Array.isArray(entry.treatment)
      ? entry.treatment
      : [];
  const status =
    entry.status ||
    entry.toothStatus ||
    entry.tooth_status ||
    (conditions.includes("missing") || treatments.includes("extraction") ? "missing" : "healthy");

  return {
    toothNumber,
    condition: conditions.map(String),
    treatments: treatments.map(String),
    notes: entry.notes || "",
    status: String(status),
    conditionLabel: conditions[0] || entry.conditionLabel || "healthy",
    updatedAt: entry.updatedAt || entry.updated_at || null,
    updatedBy: entry.updatedBy || entry.updated_by || null,
    createdAt: entry.createdAt || entry.created_at || null,
    createdBy: entry.createdBy || entry.created_by || null,
  };
}

export function labelFor(value, options) {
  return options.find((option) => option.value === value)?.label || value;
}

export function procedureRequiresTooth(procedureName) {
  const match = PROCEDURE_FORM_OPTIONS.find(
    (option) => option.value.toLowerCase() === String(procedureName || "").trim().toLowerCase()
  );
  return match ? match.toothSpecific : true;
}

export {
  FRONT_TOOTH_SHAPES,
  TOOTH_VIEW,
  frontToothShape,
  isPrimaryToothNumber,
  toothTypeFromFdi,
} from "./toothShapes";
