"use strict";

/**
 * Clinic Patient ID: PREFIX + YYYY + MM + "_" + SEQUENCE
 * A=Regular, S=Senior, P=Pediatric, W=PWD
 * Sequence resets each month per category.
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

const CANONICAL_ID = /^([ASPW])(\d{4})(0[1-9]|1[0-2])_(\d{2,})$/;

function clinicTimeZone() {
  return process.env.CLINIC_TIMEZONE || "Asia/Manila";
}

function clinicYearMonth(value) {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  const safe = Number.isFinite(date.getTime()) ? date : new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: clinicTimeZone(),
    year: "numeric",
    month: "2-digit",
  }).formatToParts(safe);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  return {
    year: Number.isFinite(year) ? year : new Date().getFullYear(),
    month: Number.isFinite(month) && month >= 1 && month <= 12 ? month : 1,
  };
}

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

function formatPatientId(prefix, year, month, sequence) {
  const seq = String(Math.max(1, Number(sequence) || 1)).padStart(2, "0");
  const monthPart = String(Math.max(1, Math.min(12, Number(month) || 1))).padStart(2, "0");
  return `${prefix}${year}${monthPart}_${seq}`;
}

function isCanonicalPatientId(value) {
  return CANONICAL_ID.test(String(value || "").trim());
}

function parseCanonicalPatientId(value) {
  const match = String(value || "").trim().match(CANONICAL_ID);
  if (!match) return null;
  return {
    prefix: match[1],
    year: Number(match[2]),
    month: Number(match[3]),
    sequence: Number(match[4]),
    category: PREFIX_CATEGORY[match[1]] || "regular",
  };
}

function categoryFromExistingId(patientId, fallbackCategory) {
  const canonical = parseCanonicalPatientId(patientId);
  if (canonical) return canonical.category;
  const prefix = String(patientId || "").trim().charAt(0).toUpperCase();
  if (PREFIX_CATEGORY[prefix]) return PREFIX_CATEGORY[prefix];
  return normalizeCategory(fallbackCategory);
}

function groupKey(prefix, year, month) {
  return `${prefix}:${year}:${String(month).padStart(2, "0")}`;
}

/**
 * Plan new IDs for a list of patient rows.
 * Canonical IDs that already match the row's category/year/month are kept.
 * Incorrect IDs are assigned the next free monthly sequence in created_at order.
 */
function planPatientIdAssignments(rows = []) {
  const grouped = new Map();
  const assigned = new Map();

  for (const row of rows) {
    const key = String(row.key ?? row.id);
    const category = categoryFromExistingId(row.patientId || row.patient_id, row.category || row.patient_category);
    const prefix = prefixForCategory(category);
    const { year, month } = clinicYearMonth(row.createdAt || row.created_at);
    const bucketKey = groupKey(prefix, year, month);
    if (!grouped.has(bucketKey)) {
      grouped.set(bucketKey, { prefix, year, month, occupied: new Map(), pending: [] });
    }
    const bucket = grouped.get(bucketKey);
    const parsed = parseCanonicalPatientId(row.patientId || row.patient_id);
    if (parsed && parsed.prefix === prefix && parsed.year === year && parsed.month === month) {
      bucket.occupied.set(parsed.sequence, key);
      assigned.set(key, formatPatientId(prefix, year, month, parsed.sequence));
      continue;
    }
    bucket.pending.push({
      key,
      createdAt: row.createdAt || row.created_at || 0,
    });
  }

  for (const bucket of grouped.values()) {
    bucket.pending.sort((left, right) => {
      const leftTime = new Date(left.createdAt).getTime();
      const rightTime = new Date(right.createdAt).getTime();
      const safeLeft = Number.isFinite(leftTime) ? leftTime : 0;
      const safeRight = Number.isFinite(rightTime) ? rightTime : 0;
      if (safeLeft !== safeRight) return safeLeft - safeRight;
      return String(left.key).localeCompare(String(right.key), "en", { numeric: true });
    });
    let sequence = 1;
    for (const row of bucket.pending) {
      while (bucket.occupied.has(sequence)) sequence += 1;
      assigned.set(row.key, formatPatientId(bucket.prefix, bucket.year, bucket.month, sequence));
      bucket.occupied.set(sequence, row.key);
      sequence += 1;
    }
  }

  return assigned;
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

function maxSequenceFromRows(rows, prefix, year, month) {
  const expected = `${prefix}${year}${String(month).padStart(2, "0")}_`;
  let maxSeq = 0;
  for (const row of rows || []) {
    const value = String(row.patient_id || "");
    if (!value.startsWith(expected)) continue;
    const match = value.match(/_(\d+)$/);
    if (match) maxSeq = Math.max(maxSeq, Number(match[1]));
  }
  return maxSeq;
}

/**
 * Atomically allocate the next Patient ID for a category/year/month.
 * Uses patient_id_sequences with upsert; falls back to MAX scan if the table is missing.
 */
async function allocatePatientId(db, { category = "regular", createdAt = null } = {}) {
  const normalized = normalizeCategory(category);
  const prefix = prefixForCategory(normalized);
  const { year, month } = clinicYearMonth(createdAt);

  const sequenced = await tryQuery(db, async () => {
    const result = await db.query(
      `INSERT INTO patient_id_sequences (category_prefix, id_year, id_month, last_sequence)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (category_prefix, id_year, id_month) DO UPDATE
         SET last_sequence = patient_id_sequences.last_sequence + 1,
             updated_at = CURRENT_TIMESTAMP
       RETURNING last_sequence, id_year, id_month, category_prefix`,
      [prefix, year, month]
    );
    return result.rows[0];
  });
  if (sequenced) {
    return {
      patientId: formatPatientId(
        sequenced.category_prefix,
        sequenced.id_year,
        sequenced.id_month,
        sequenced.last_sequence
      ),
      category: normalized,
      prefix: sequenced.category_prefix,
      year: sequenced.id_year,
      month: sequenced.id_month,
      sequence: sequenced.last_sequence,
    };
  }

  const like = `${prefix}${year}${String(month).padStart(2, "0")}_%`;
  let maxSeq = 0;
  const users = await tryQuery(db, async () =>
    db.query(`SELECT patient_id FROM users WHERE patient_id LIKE $1`, [like])
  );
  maxSeq = Math.max(maxSeq, maxSequenceFromRows(users?.rows, prefix, year, month));
  const clinical = await tryQuery(db, async () =>
    db.query(`SELECT patient_id FROM clinic_patient_records WHERE patient_id LIKE $1`, [like])
  );
  maxSeq = Math.max(maxSeq, maxSequenceFromRows(clinical?.rows, prefix, year, month));

  const sequence = maxSeq + 1;
  return {
    patientId: formatPatientId(prefix, year, month, sequence),
    category: normalized,
    prefix,
    year,
    month,
    sequence,
  };
}

async function rebuildSequenceTable(db, ids) {
  const counters = new Map();
  for (const patientId of ids) {
    const parsed = parseCanonicalPatientId(patientId);
    if (!parsed) continue;
    const key = groupKey(parsed.prefix, parsed.year, parsed.month);
    counters.set(key, Math.max(counters.get(key) || 0, parsed.sequence));
  }
  await db.query(`DELETE FROM patient_id_sequences`);
  for (const [key, lastSequence] of counters.entries()) {
    const [prefix, year, month] = key.split(":");
    await db.query(
      `INSERT INTO patient_id_sequences (category_prefix, id_year, id_month, last_sequence)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (category_prefix, id_year, id_month) DO UPDATE
         SET last_sequence = GREATEST(patient_id_sequences.last_sequence, EXCLUDED.last_sequence),
             updated_at = CURRENT_TIMESTAMP`,
      [prefix, Number(year), Number(month), lastSequence]
    );
  }
}

async function seedMonthlySequencesFromExistingIds(db) {
  let issued = { rows: [] };
  try {
    issued = await db.query(
      `SELECT patient_id FROM users WHERE patient_id IS NOT NULL
       UNION
       SELECT patient_id FROM clinic_patient_records WHERE patient_id IS NOT NULL`
    );
  } catch (error) {
    if (error?.code !== "42P01" && error?.code !== "42703") throw error;
    issued = await db.query(`SELECT patient_id FROM users WHERE patient_id IS NOT NULL`);
  }
  await rebuildSequenceTable(
    db,
    issued.rows.map((row) => row.patient_id)
  );
  return { preserved: issued.rows.length };
}

module.exports = {
  CATEGORY_PREFIX,
  PREFIX_CATEGORY,
  CATEGORY_LABELS,
  normalizeCategory,
  prefixForCategory,
  formatPatientId,
  isCanonicalPatientId,
  parseCanonicalPatientId,
  clinicYearMonth,
  planPatientIdAssignments,
  allocatePatientId,
  seedMonthlySequencesFromExistingIds,
};
