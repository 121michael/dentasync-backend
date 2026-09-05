/** FDI adult permanent dentition — visual order matches standard dental chart reference. */

export const UPPER_TEETH = [
  18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28,
];

export const LOWER_TEETH = [
  48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38,
];

export const ALL_TEETH = [...UPPER_TEETH, ...LOWER_TEETH];

export const CONDITION_OPTIONS = [
  { value: "healthy", label: "Healthy" },
  { value: "decay", label: "Decay" },
  { value: "caries", label: "Caries" },
  { value: "missing", label: "Missing" },
  { value: "fractured", label: "Fractured" },
  { value: "impacted", label: "Impacted" },
  { value: "sensitive", label: "Sensitive" },
  { value: "other", label: "Other" },
];

export const TREATMENT_OPTIONS = [
  { value: "filling", label: "Filling" },
  { value: "extraction", label: "Extraction" },
  { value: "cleaning", label: "Cleaning" },
  { value: "root_canal", label: "Root Canal" },
  { value: "crown", label: "Crown" },
  { value: "denture", label: "Denture" },
  { value: "sealant", label: "Sealant" },
  { value: "braces", label: "Braces / Orthodontic Treatment" },
  { value: "other", label: "Other" },
];

export const STATUS_OPTIONS = [
  { value: "healthy", label: "Healthy" },
  { value: "needs_attention", label: "Needs Attention" },
  { value: "under_treatment", label: "Under Treatment" },
  { value: "treated", label: "Treated" },
  { value: "missing", label: "Missing" },
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

export function buildDefaultChart() {
  const chart = {};
  for (const tooth of ALL_TEETH) {
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
    (conditions.includes("missing") ? "missing" : "healthy");

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

export { toothPositions, toothTypeFromFdi, toothScale } from "./toothShapes";

