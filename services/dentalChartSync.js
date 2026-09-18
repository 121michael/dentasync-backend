"use strict";

/**
 * Maps clinical treatment records → dental chart tooth status.
 * Treatment history remains the source of truth; the chart is derived/updated from it.
 */

const TOOTH_SPECIFIC_KEYS = new Set([
  "root_canal",
  "filling",
  "extraction",
  "crown",
  "bridge",
  "sealant",
  "denture",
]);

const PROCEDURE_CATALOG = [
  { value: "Root Canal", key: "root_canal", toothSpecific: true },
  { value: "Dental Filling", key: "filling", toothSpecific: true },
  { value: "Tooth Restoration", key: "filling", toothSpecific: true },
  { value: "Extraction", key: "extraction", toothSpecific: true },
  { value: "Crown", key: "crown", toothSpecific: true },
  { value: "Bridge", key: "bridge", toothSpecific: true },
  { value: "Sealant", key: "sealant", toothSpecific: true },
  { value: "Cleaning / Oral Prophylaxis", key: "cleaning", toothSpecific: false },
  { value: "Orthodontic Treatment", key: "braces", toothSpecific: false },
  { value: "Denture", key: "denture", toothSpecific: true },
  { value: "Other", key: "other", toothSpecific: false },
];

const TREATMENT_MATCHERS = [
  { match: /root\s*canal|\brct\b/i, key: "root_canal", status: "treated" },
  { match: /tooth\s*restor|dental\s*fill|\bfilling\b|composite|amalgam|restorat/i, key: "filling", status: "treated" },
  { match: /\bextract|\bexo\b|pull(ed)?\b/i, key: "extraction", status: "missing" },
  { match: /\bcrown\b/i, key: "crown", status: "treated" },
  { match: /\bbridge\b|\bfpd\b|fixed\s*partial/i, key: "bridge", status: "treated" },
  { match: /sealant/i, key: "sealant", status: "treated" },
  { match: /denture/i, key: "denture", status: "treated" },
  { match: /clean|prophylaxis|scaling|oral\s*proph/i, key: "cleaning", status: "treated" },
  { match: /ortho|brace|bracket|aligner/i, key: "braces", status: "under_treatment" },
];

const STATUS_PRIORITY = {
  missing: 50,
  under_treatment: 40,
  treated: 30,
  needs_attention: 20,
  healthy: 0,
};

function stringValue(value, max = 200) {
  if (value == null) return "";
  return String(value).trim().slice(0, max);
}

function mapTreatmentNameToChart(treatmentName) {
  const text = stringValue(treatmentName, 200);
  if (!text) return null;
  for (const matcher of TREATMENT_MATCHERS) {
    if (matcher.match.test(text)) {
      return {
        key: matcher.key,
        status: matcher.status,
        toothSpecific: TOOTH_SPECIFIC_KEYS.has(matcher.key),
      };
    }
  }
  return { key: "other", status: "treated", toothSpecific: false };
}

function isToothSpecificTreatment(treatmentName) {
  const mapped = mapTreatmentNameToChart(treatmentName);
  if (!mapped) return false;
  const catalog = PROCEDURE_CATALOG.find(
    (item) => item.value.toLowerCase() === stringValue(treatmentName, 200).toLowerCase()
  );
  if (catalog) return catalog.toothSpecific;
  return mapped.toothSpecific;
}

/**
 * Parse FDI tooth numbers from free text: "36", "#36", "14, 15", "14-16", "16 & 17".
 */
function parseAffectedTeeth(value) {
  const text = stringValue(value, 80);
  if (!text) return [];
  const teeth = new Set();
  const tokens = text.split(/[,;/&+\s]+/).filter(Boolean);
  for (const token of tokens) {
    const cleaned = token.replace(/^#/, "");
    const range = cleaned.match(/^(\d{1,2})\s*[-–]\s*(\d{1,2})$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (Number.isFinite(start) && Number.isFinite(end)) {
        const lo = Math.min(start, end);
        const hi = Math.max(start, end);
        for (let n = lo; n <= hi; n += 1) {
          if (isValidFdiTooth(n)) teeth.add(String(n));
        }
      }
      continue;
    }
    const single = cleaned.match(/^(\d{1,2})$/);
    if (single && isValidFdiTooth(Number(single[1]))) {
      teeth.add(String(Number(single[1])));
    }
  }
  return [...teeth];
}

function isValidFdiTooth(n) {
  if (!Number.isInteger(n) || n < 11 || n > 48) return false;
  const decade = Math.floor(n / 10);
  const unit = n % 10;
  return [1, 2, 3, 4].includes(decade) && unit >= 1 && unit <= 8;
}

function preferStatus(current, next) {
  const a = STATUS_PRIORITY[current] || 0;
  const b = STATUS_PRIORITY[next] || 0;
  return b >= a ? next : current;
}

function treatmentSortKey(row) {
  const date = String(row.treatment_date || row.treatmentDate || "").slice(0, 10);
  const id = Number(row.id) || 0;
  return `${date}|${String(id).padStart(12, "0")}`;
}

/**
 * Upsert chart entries for teeth affected by one treatment row.
 */
async function syncChartFromTreatment(db, clinicalRecordId, treatmentRow, actor = {}) {
  const treatmentName = treatmentRow.treatment || treatmentRow.name || "";
  const mapped = mapTreatmentNameToChart(treatmentName);
  if (!mapped) return [];

  const teeth = parseAffectedTeeth(treatmentRow.tooth_number || treatmentRow.toothNumber);
  if (!teeth.length) {
    if (mapped.toothSpecific || isToothSpecificTreatment(treatmentName)) {
      const error = new Error("Affected tooth is required for this treatment.");
      error.status = 400;
      throw error;
    }
    return [];
  }

  const actorId = actor.id ? String(actor.id) : null;
  const diagnosis =
    stringValue(treatmentRow.diagnosis_notes || treatmentRow.diagnosisNotes, 2000) ||
    stringValue(treatmentRow.notes, 2000);
  const saved = [];

  for (const toothNumber of teeth) {
    let existing = { treatments: [], status: "healthy", conditions: [], notes: "" };
    try {
      const current = await db.query(
        `SELECT tooth_status, conditions_json, treatments_json, notes, condition_label
         FROM clinic_dental_chart_entries
         WHERE clinical_record_id = $1 AND tooth_number = $2
         LIMIT 1`,
        [clinicalRecordId, toothNumber]
      );
      if (current.rows[0]) {
        const row = current.rows[0];
        existing = {
          status: row.tooth_status || "healthy",
          conditions: Array.isArray(row.conditions_json)
            ? row.conditions_json
            : typeof row.conditions_json === "string"
              ? JSON.parse(row.conditions_json || "[]")
              : [],
          treatments: Array.isArray(row.treatments_json)
            ? row.treatments_json
            : typeof row.treatments_json === "string"
              ? JSON.parse(row.treatments_json || "[]")
              : [],
          notes: row.notes || "",
        };
      }
    } catch (error) {
      if (error?.code === "42P01") return [];
      if (error?.code === "42703") {
        return [];
      }
      throw error;
    }

    const treatments = [...new Set([...(existing.treatments || []).map(String), mapped.key])];
    let status = preferStatus(existing.status || "healthy", mapped.status);
    let conditions = [...(existing.conditions || [])].map(String);
    if (mapped.key === "extraction") {
      status = "missing";
      if (!conditions.includes("missing")) {
        conditions = [...conditions.filter((c) => c !== "healthy"), "missing"];
      }
    } else if (status !== "missing" && conditions.includes("healthy") && conditions.length === 1) {
      conditions = [];
    }

    const notes = diagnosis
      ? existing.notes && existing.notes.includes(diagnosis)
        ? existing.notes
        : [existing.notes, diagnosis].filter(Boolean).join("\n").slice(0, 2000)
      : existing.notes;

    const conditionLabel = conditions[0] || (status === "missing" ? "missing" : mapped.key);

    try {
      const result = await db.query(
        `INSERT INTO clinic_dental_chart_entries (
           clinical_record_id, tooth_number, condition_label, notes,
           created_by, created_by_role, tooth_status, conditions_json, treatments_json, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $5)
         ON CONFLICT (clinical_record_id, tooth_number) DO UPDATE SET
           condition_label = EXCLUDED.condition_label,
           notes = EXCLUDED.notes,
           tooth_status = EXCLUDED.tooth_status,
           conditions_json = EXCLUDED.conditions_json,
           treatments_json = EXCLUDED.treatments_json,
           updated_by = EXCLUDED.updated_by,
           updated_at = CURRENT_TIMESTAMP
         RETURNING
           id, tooth_number, condition_label, notes, created_by, created_by_role,
           created_at, updated_at, tooth_status, conditions_json, treatments_json, updated_by`,
        [
          clinicalRecordId,
          toothNumber,
          conditionLabel,
          notes,
          actorId,
          actor.role || "dentist",
          status,
          JSON.stringify(conditions.length ? conditions : ["healthy"]),
          JSON.stringify(treatments),
        ]
      );
      if (result.rows[0]) saved.push(result.rows[0]);
    } catch (error) {
      if (error?.code === "42P01" || error?.code === "42703") return saved;
      throw error;
    }
  }

  return saved;
}

/**
 * Rebuild chart statuses from full treatment history (latest applicable per tooth).
 * Does not delete prior treatment rows — only upserts chart entries.
 */
async function rebuildChartFromTreatments(db, clinicalRecordId, actor = {}) {
  let treatments;
  try {
    treatments = await db.query(
      `SELECT id, treatment, treatment_date, tooth_number, diagnosis_notes, notes, status
       FROM clinic_patient_treatments
       WHERE clinical_record_id = $1
       ORDER BY treatment_date ASC, id ASC`,
      [clinicalRecordId]
    );
  } catch (error) {
    if (error?.code === "42P01") return [];
    throw error;
  }

  const byTooth = new Map();
  for (const row of treatments.rows) {
    const mapped = mapTreatmentNameToChart(row.treatment);
    if (!mapped) continue;
    const teeth = parseAffectedTeeth(row.tooth_number);
    if (!teeth.length) continue;
    for (const tooth of teeth) {
      const current = byTooth.get(tooth) || {
        treatments: [],
        status: "healthy",
        diagnosis: "",
        sortKey: "",
      };
      current.treatments = [...new Set([...current.treatments, mapped.key])];
      const sortKey = treatmentSortKey(row);
      if (!current.sortKey || sortKey >= current.sortKey) {
        current.status = mapped.key === "extraction" ? "missing" : mapped.status;
        current.diagnosis = stringValue(row.diagnosis_notes || row.notes, 2000);
        current.sortKey = sortKey;
        current.latestKey = mapped.key;
      }
      byTooth.set(tooth, current);
    }
  }

  const saved = [];
  for (const [toothNumber, info] of byTooth.entries()) {
    const conditions =
      info.status === "missing" ? ["missing"] : info.latestKey ? [info.latestKey] : ["healthy"];
    try {
      const result = await db.query(
        `INSERT INTO clinic_dental_chart_entries (
           clinical_record_id, tooth_number, condition_label, notes,
           created_by, created_by_role, tooth_status, conditions_json, treatments_json, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $5)
         ON CONFLICT (clinical_record_id, tooth_number) DO UPDATE SET
           condition_label = EXCLUDED.condition_label,
           notes = EXCLUDED.notes,
           tooth_status = EXCLUDED.tooth_status,
           conditions_json = EXCLUDED.conditions_json,
           treatments_json = EXCLUDED.treatments_json,
           updated_by = EXCLUDED.updated_by,
           updated_at = CURRENT_TIMESTAMP
         RETURNING tooth_number, tooth_status, treatments_json`,
        [
          clinicalRecordId,
          toothNumber,
          conditions[0],
          info.diagnosis,
          actor.id ? String(actor.id) : null,
          actor.role || "system",
          info.status,
          JSON.stringify(conditions),
          JSON.stringify(info.treatments),
        ]
      );
      if (result.rows[0]) saved.push(result.rows[0]);
    } catch (error) {
      if (error?.code === "42P01" || error?.code === "42703") return saved;
      throw error;
    }
  }
  return saved;
}

module.exports = {
  PROCEDURE_CATALOG,
  TREATMENT_MATCHERS,
  mapTreatmentNameToChart,
  isToothSpecificTreatment,
  parseAffectedTeeth,
  isValidFdiTooth,
  syncChartFromTreatment,
  rebuildChartFromTreatments,
};
