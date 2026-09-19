"use strict";

/**
 * Clinic Patient ID: PREFIX + YEAR + "_" + SEQUENCE
 * A=Regular, S=Senior, P=Pediatric, W=PWD
 */

const CATEGORY_PREFIX = {
  regular: "A",
  senior: "S",
  pediatric: "P",
  pwd: "W",
};

const PREFIX_CATEGORY = {
  A: "regular",
  S: "senior",
  P: "pediatric",
  W: "pwd",
};

const CATEGORY_LABELS = {
  regular: "Regular Patient",
  senior: "Senior Citizen",
  pediatric: "Pediatric Patient",
  pwd: "Person with Disability (PWD)",
};

function normalizeCategory(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!raw) return "regular";
  if (raw === "a" || raw === "regular" || raw === "regular_patient") return "regular";
  if (raw === "s" || raw === "senior" || raw === "senior_citizen") return "senior";
  if (raw === "p" || raw === "pediatric" || raw === "pediatric_patient" || raw === "child") {
    return "pediatric";
  }
  if (raw === "w" || raw === "pwd" || raw === "person_with_disability" || raw === "disability") {
    return "pwd";
  }
  return "regular";
}

function prefixForCategory(category) {
  return CATEGORY_PREFIX[normalizeCategory(category)] || "A";
}

function formatPatientId(prefix, year, sequence) {
  const seq = String(Math.max(1, Number(sequence) || 1)).padStart(2, "0");
  return `${prefix}${year}_${seq}`;
}

async function tryQuery(db, fn) {
  const savepoint = `pid_${Math.random().toString(36).slice(2, 10)}`;
  try {
    await db.query(`SAVEPOINT ${savepoint}`);
  } catch {
    try {
      return await fn();
    } catch {
      return null;
    }
  }
  try {
    const result = await fn();
    await db.query(`RELEASE SAVEPOINT ${savepoint}`).catch(() => {});
    return result;
  } catch {
    await db.query(`ROLLBACK TO SAVEPOINT ${savepoint}`).catch(() => {});
    return null;
  }
}

/**
 * Atomically allocate the next Patient ID for a category/year.
 * Uses patient_id_sequences with row lock; falls back to MAX scan if table missing.
 */
async function allocatePatientId(db, { category = "regular", createdAt = null } = {}) {
  const normalized = normalizeCategory(category);
  const prefix = prefixForCategory(normalized);
  const when = createdAt ? new Date(createdAt) : new Date();
  const year = Number.isFinite(when.getTime()) ? when.getFullYear() : new Date().getFullYear();

  const sequenced = await tryQuery(db, async () => {
    const result = await db.query(
      `INSERT INTO patient_id_sequences (category_prefix, id_year, last_sequence)
       VALUES ($1, $2, 1)
       ON CONFLICT (category_prefix, id_year) DO UPDATE
         SET last_sequence = patient_id_sequences.last_sequence + 1,
             updated_at = CURRENT_TIMESTAMP
       RETURNING last_sequence, id_year, category_prefix`,
      [prefix, year]
    );
    return result.rows[0];
  });
  if (sequenced) {
    return {
      patientId: formatPatientId(sequenced.category_prefix, sequenced.id_year, sequenced.last_sequence),
      category: normalized,
      prefix: sequenced.category_prefix,
      year: sequenced.id_year,
      sequence: sequenced.last_sequence,
    };
  }

  // Fallback when sequences table is not migrated yet: scan existing IDs.
  const like = `${prefix}${year}_%`;
  let maxSeq = 0;
  const users = await tryQuery(db, async () =>
    db.query(`SELECT patient_id FROM users WHERE patient_id LIKE $1`, [like])
  );
  for (const row of users?.rows || []) {
    const match = String(row.patient_id || "").match(/_(\d+)$/);
    if (match) maxSeq = Math.max(maxSeq, Number(match[1]));
  }
  const clinical = await tryQuery(db, async () =>
    db.query(`SELECT patient_id FROM clinic_patient_records WHERE patient_id LIKE $1`, [like])
  );
  for (const row of clinical?.rows || []) {
    const match = String(row.patient_id || "").match(/_(\d+)$/);
    if (match) maxSeq = Math.max(maxSeq, Number(match[1]));
  }

  const sequence = maxSeq + 1;
  return {
    patientId: formatPatientId(prefix, year, sequence),
    category: normalized,
    prefix,
    year,
    sequence,
  };
}

module.exports = {
  CATEGORY_PREFIX,
  PREFIX_CATEGORY,
  CATEGORY_LABELS,
  normalizeCategory,
  prefixForCategory,
  formatPatientId,
  allocatePatientId,
};
