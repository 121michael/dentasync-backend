"use strict";

/**
 * Admin patient document intake.
 *
 *   Upload/Scan → OCR (documentSyncExtraction) → intake fields (patientIntakeFields)
 *   → Admin review/edit → duplicate check → map onto the CANONICAL patient record.
 *
 * Intake never verifies an account and never creates an isolated "OCR patient".
 * Saved documents belong to the patient (patient_documents.clinical_record_id / linked_user_id).
 */

const fs = require("fs");
const path = require("path");
const { extractDocumentData, DocumentValidationError } = require("./documentSyncExtraction");
const intakeFields = require("./patientIntakeFields");
const patientData = require("./patientData");
const patientIds = require("./patientIds");
const clinicalPatients = require("./clinicalPatients");
const { resolveTempDocumentPath, discardTemporaryDocumentFile } = require("./documentSyncTempStorage");

const OPEN_STATUSES = new Set(["draft"]);

function httpError(message, status = 400, extra = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, extra);
  return error;
}

function isMissingRelation(error) {
  return error?.code === "42P01";
}

function mapDocument(row, uploadDirectory) {
  const storedPath = row.stored_name ? resolveTempDocumentPath(uploadDirectory, row.stored_name) : null;
  return {
    id: Number(row.id),
    sessionId: row.session_id != null ? Number(row.session_id) : null,
    clinicalRecordId: row.clinical_record_id != null ? Number(row.clinical_record_id) : null,
    linkedUserId: row.linked_user_id || null,
    patientId: row.patient_id || null,
    originalName: row.original_name,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size || 0),
    sourceType: row.source_type,
    status: row.status,
    pageCount: Number(row.page_count || 1),
    fields: row.extracted_fields || {},
    extractionMethod: row.extraction_method || null,
    extractionNotes: row.extraction_notes || "",
    errorMessage: row.error_message || null,
    processedBy: row.processed_by || null,
    hasPreview: Boolean(storedPath && fs.existsSync(storedPath)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSession(row, documents = []) {
  const fields = row.fields && Object.keys(row.fields).length ? row.fields : intakeFields.emptyIntakeFields();
  const validation = intakeFields.validateIntakeFields(fields, {
    categoryConfirmed: Boolean(row.category_confirmed),
  });
  const values = intakeFields.fieldValues(fields);
  const suggestedCategory = intakeFields.suggestPatientCategory({
    dateOfBirth: values.dateOfBirth,
    rawText: documents.map((doc) => doc.extractionNotes || "").join(" "),
  });
  return {
    id: Number(row.id),
    status: row.status,
    createdBy: row.created_by,
    fields,
    values,
    conflicts: Array.isArray(row.conflicts) ? row.conflicts : [],
    categoryConfirmed: Boolean(row.category_confirmed),
    suggestedCategory,
    validation,
    age: patientData.ageFromDateOfBirth(values.dateOfBirth),
    linkedUserId: row.linked_user_id || null,
    clinicalRecordId: row.clinical_record_id != null ? Number(row.clinical_record_id) : null,
    patientId: row.patient_id || null,
    savedAt: row.saved_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    documents,
    fieldMapping: intakeFields.DOCUMENT_FIELD_MAPPING,
  };
}

async function loadSessionRow(db, sessionId, { forUpdate = false } = {}) {
  const result = await db.query(
    `SELECT * FROM admin_patient_intake_sessions WHERE id = $1${forUpdate ? " FOR UPDATE" : ""}`,
    [sessionId]
  );
  if (!result.rows.length) throw httpError("Patient intake session not found.", 404);
  return result.rows[0];
}

async function loadDocuments(db, sessionId, uploadDirectory) {
  const result = await db.query(
    `SELECT * FROM patient_documents WHERE session_id = $1 ORDER BY created_at, id`,
    [sessionId]
  );
  return result.rows.map((row) => mapDocument(row, uploadDirectory));
}

async function createSession(db, admin) {
  const result = await db.query(
    `INSERT INTO admin_patient_intake_sessions (created_by, fields, manual_fields, conflicts)
     VALUES ($1, $2::jsonb, '{}'::jsonb, '[]'::jsonb)
     RETURNING *`,
    [String(admin.id), JSON.stringify(intakeFields.emptyIntakeFields())]
  );
  return mapSession(result.rows[0], []);
}

async function listSessions(db, uploadDirectory, { limit = 20 } = {}) {
  const result = await db.query(
    `SELECT session.*,
            COUNT(doc.id)::int AS document_count
     FROM admin_patient_intake_sessions AS session
     LEFT JOIN patient_documents AS doc ON doc.session_id = session.id
     GROUP BY session.id
     ORDER BY session.created_at DESC
     LIMIT $1`,
    [Math.min(100, Math.max(1, limit))]
  );
  return result.rows.map((row) => ({
    ...mapSession(row, []),
    documentCount: Number(row.document_count || 0),
    documents: undefined,
  }));
}

async function getSession(db, sessionId, uploadDirectory) {
  const row = await loadSessionRow(db, sessionId);
  const documents = await loadDocuments(db, sessionId, uploadDirectory);
  return mapSession(row, documents);
}

/** Recompute merged fields + conflicts from processed documents and manual edits. */
async function remergeSession(db, sessionRow, uploadDirectory) {
  const documents = await loadDocuments(db, sessionRow.id, uploadDirectory);
  const processed = documents.filter((doc) => doc.status === "processed" || doc.status === "attached");
  const { fields, conflicts } = intakeFields.mergeDocumentFields(processed, sessionRow.manual_fields || {});
  const result = await db.query(
    `UPDATE admin_patient_intake_sessions
     SET fields = $1::jsonb, conflicts = $2::jsonb, updated_at = CURRENT_TIMESTAMP
     WHERE id = $3
     RETURNING *`,
    [JSON.stringify(fields), JSON.stringify(conflicts), sessionRow.id]
  );
  return mapSession(result.rows[0], documents);
}

function countPages(rawText, mimeType) {
  if (mimeType !== "application/pdf") return 1;
  const breaks = String(rawText || "").split("\f").filter((page) => page.trim()).length;
  return Math.max(1, breaks);
}

/**
 * Store + process one uploaded/scanned document for a session.
 * Failures keep the document row (status failed) so the Admin can retry, replace, or
 * enter information manually; the file itself is discarded on failure.
 */
async function processDocument(db, sessionId, file, { sourceType = "upload", admin, uploadDirectory }) {
  const sessionRow = await loadSessionRow(db, sessionId);
  if (!OPEN_STATUSES.has(sessionRow.status)) {
    fs.unlink(file.path, () => {});
    throw httpError("This intake session is already closed.", 409);
  }
  if (!file.size) {
    fs.unlink(file.path, () => {});
    throw httpError("The uploaded file is empty. Please upload a readable document.", 400, {
      code: "INVALID_DOCUMENT",
    });
  }

  const inserted = await db.query(
    `INSERT INTO patient_documents (
       session_id, original_name, stored_name, mime_type, byte_size, source_type, status, processed_by
     ) VALUES ($1, $2, $3, $4, $5, $6, 'processing', $7)
     RETURNING *`,
    [
      sessionId,
      file.originalname,
      file.filename,
      file.mimetype,
      file.size,
      sourceType === "scan" ? "scan" : "upload",
      String(admin.id),
    ]
  );
  const documentRow = inserted.rows[0];

  try {
    const extraction = await extractDocumentData(file.path, file.mimetype, file.originalname);
    const fields = intakeFields.buildFieldsFromExtraction(extraction, {
      id: Number(documentRow.id),
      originalName: file.originalname,
    });
    const readable = Object.values(fields).filter((field) => field.value).length;
    if (!readable) {
      throw new DocumentValidationError(
        "The document could not be read. No patient information was detected. Please upload a clearer image or scan."
      );
    }

    const updated = await db.query(
      `UPDATE patient_documents
       SET status = 'processed',
           page_count = $1,
           extracted_fields = $2::jsonb,
           extraction_method = $3,
           extraction_notes = $4,
           error_message = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING *`,
      [
        countPages(extraction.rawText, file.mimetype),
        JSON.stringify(fields),
        extraction.method || null,
        [extraction.extractionNotes || "", intakeFields.detectCategoryHints(extraction.rawText)]
          .filter(Boolean)
          .join(" ")
          .slice(0, 2000),
        documentRow.id,
      ]
    );

    const session = await remergeSession(db, sessionRow, uploadDirectory);
    return { session, document: mapDocument(updated.rows[0], uploadDirectory), readableFields: readable };
  } catch (error) {
    const isValidation = error instanceof DocumentValidationError || error?.code === "INVALID_DOCUMENT";
    discardTemporaryDocumentFile(uploadDirectory, file.filename);
    await db
      .query(
        `UPDATE patient_documents
         SET status = 'failed', stored_name = NULL, error_message = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [String(error.message || "Document processing failed.").slice(0, 1000), documentRow.id]
      )
      .catch(() => {});
    throw httpError(
      error.message || "We could not reliably extract information from this document.",
      isValidation ? 400 : 500,
      { code: isValidation ? "INVALID_DOCUMENT" : "EXTRACTION_FAILED", documentId: Number(documentRow.id) }
    );
  }
}

async function removeDocument(db, sessionId, documentId, uploadDirectory) {
  const sessionRow = await loadSessionRow(db, sessionId);
  if (!OPEN_STATUSES.has(sessionRow.status)) throw httpError("This intake session is already closed.", 409);
  const result = await db.query(
    `DELETE FROM patient_documents WHERE id = $1 AND session_id = $2 RETURNING stored_name`,
    [documentId, sessionId]
  );
  if (!result.rows.length) throw httpError("Document not found in this intake session.", 404);
  discardTemporaryDocumentFile(uploadDirectory, result.rows[0].stored_name);
  return remergeSession(db, sessionRow, uploadDirectory);
}

async function getDocumentFile(db, sessionId, documentId, uploadDirectory) {
  const result = await db.query(
    `SELECT * FROM patient_documents WHERE id = $1 AND session_id = $2`,
    [documentId, sessionId]
  );
  if (!result.rows.length) throw httpError("Document not found.", 404);
  const row = result.rows[0];
  const filePath = row.stored_name ? resolveTempDocumentPath(uploadDirectory, row.stored_name) : null;
  if (!filePath || !fs.existsSync(filePath)) throw httpError("Document file is no longer available.", 410);
  return { filePath, mimeType: row.mime_type, originalName: row.original_name };
}

/**
 * Admin edits. `edits` is { fieldKey: value }. `resolveConflicts` is { fieldKey: value }
 * choosing a document value; both become manual (Admin-confirmed) values.
 */
async function updateSessionFields(db, sessionId, { edits = {}, resolveConflicts = {}, categoryConfirmed } = {}, uploadDirectory) {
  const sessionRow = await loadSessionRow(db, sessionId);
  if (!OPEN_STATUSES.has(sessionRow.status)) throw httpError("This intake session is already closed.", 409);

  const combined = { ...(resolveConflicts || {}), ...(edits || {}) };
  const manual = intakeFields.applyManualEdits(sessionRow.manual_fields || {}, combined);
  // Only keep manual entries (extracted values are re-derived from documents).
  const manualOnly = {};
  for (const key of intakeFields.FIELD_KEYS) {
    if (manual[key]?.status === "manual") manualOnly[key] = manual[key];
  }

  let confirmed = sessionRow.category_confirmed;
  if (typeof categoryConfirmed === "boolean") confirmed = categoryConfirmed;
  if (Object.prototype.hasOwnProperty.call(combined, "patientCategory")) {
    confirmed = Boolean(patientData.stringValue(combined.patientCategory));
  }

  const updated = await db.query(
    `UPDATE admin_patient_intake_sessions
     SET manual_fields = $1::jsonb, category_confirmed = $2, updated_at = CURRENT_TIMESTAMP
     WHERE id = $3
     RETURNING *`,
    [JSON.stringify(manualOnly), confirmed, sessionId]
  );
  return remergeSession(db, updated.rows[0], uploadDirectory);
}

function phoneCandidates(phone) {
  const digits = patientData.normalizePhone(phone);
  if (!digits) return [];
  const set = new Set([digits]);
  if (/^63\d{10}$/.test(digits)) set.add(`0${digits.slice(2)}`);
  return [...set];
}

/**
 * Possible existing patients (accounts and clinical records) for the reviewed data.
 * Never auto-links: returns candidates with match reasons for Admin review.
 */
async function findPatientMatches(db, fields) {
  const values = intakeFields.fieldValues(fields);
  const phones = phoneCandidates(values.phone);
  const email = values.email ? values.email.toLowerCase() : null;
  const dob = patientData.normalizeIsoDate(values.dateOfBirth) || null;
  const first = values.firstName || null;
  const last = values.lastName || null;

  const matches = [];

  let accounts = { rows: [] };
  try {
    accounts = await db.query(
      `SELECT account.id::text AS id, account.first_name, account.last_name, account.email, account.phone,
              account.patient_id, account.patient_category, account.status, account.is_verified,
              COALESCE(profile.date_of_birth, profile.birth_date) AS date_of_birth, profile.gender, profile.address
       FROM users AS account
       LEFT JOIN patient_portal_profiles AS profile ON profile.user_id::text = account.id::text
       WHERE LOWER(account.role) = 'patient'
         AND COALESCE(account.is_archived, FALSE) = FALSE
         AND (
           ($1::text IS NOT NULL AND LOWER(account.email) = $1)
           OR ($2::text[] IS NOT NULL AND account.phone = ANY($2))
           OR ($3::text IS NOT NULL AND $4::text IS NOT NULL
               AND LOWER(account.first_name) = LOWER($3) AND LOWER(account.last_name) = LOWER($4))
         )
       LIMIT 10`,
      [email, phones.length ? phones : null, first, last]
    );
  } catch (error) {
    if (error?.code !== "42703" && !isMissingRelation(error)) throw error;
  }
  for (const row of accounts.rows) {
    matches.push(describeMatch("account", row, { email, phones, first, last, dob }));
  }

  let records = { rows: [] };
  try {
    records = await db.query(
      `SELECT id, record_code, first_name, last_name, email, phone, date_of_birth, gender, address,
              patient_id, patient_category, linked_user_id
       FROM clinic_patient_records
       WHERE COALESCE(is_archived, FALSE) = FALSE
         AND (
           ($1::text IS NOT NULL AND LOWER(email) = $1)
           OR ($2::text[] IS NOT NULL AND phone = ANY($2))
           OR ($3::text IS NOT NULL AND $4::text IS NOT NULL
               AND LOWER(first_name) = LOWER($3) AND LOWER(last_name) = LOWER($4))
         )
       ORDER BY updated_at DESC
       LIMIT 10`,
      [email, phones.length ? phones : null, first, last]
    );
  } catch (error) {
    if (error?.code !== "42703" && !isMissingRelation(error)) throw error;
  }
  for (const row of records.rows) {
    // Skip clinical records already represented by a matched account.
    if (row.linked_user_id && matches.some((m) => m.type === "account" && m.id === String(row.linked_user_id))) {
      const account = matches.find((m) => m.type === "account" && m.id === String(row.linked_user_id));
      account.clinicalRecordId = Number(row.id);
      account.recordCode = row.record_code;
      continue;
    }
    matches.push(describeMatch("clinical_record", row, { email, phones, first, last, dob }));
  }

  matches.sort((a, b) => b.score - a.score);
  return matches;
}

function describeMatch(type, row, { email, phones, first, last, dob }) {
  const reasons = [];
  let score = 0;
  if (email && String(row.email || "").toLowerCase() === email) {
    reasons.push("email");
    score += 40;
  }
  if (phones.length && phones.includes(String(row.phone || ""))) {
    reasons.push("phone");
    score += 35;
  }
  const rowDob = patientData.normalizeIsoDate(row.date_of_birth);
  const nameMatches =
    first && last &&
    String(row.first_name || "").toLowerCase() === first.toLowerCase() &&
    String(row.last_name || "").toLowerCase() === last.toLowerCase();
  if (nameMatches) {
    reasons.push("name");
    score += 20;
    if (dob && rowDob === dob) {
      reasons.push("birthdate");
      score += 30;
    }
  }
  const differences = [];
  if (phones.length && row.phone && !phones.includes(String(row.phone))) {
    differences.push({ field: "phone", existing: String(row.phone), document: phones[0] });
  }
  if (dob && rowDob && rowDob !== dob) {
    differences.push({ field: "dateOfBirth", existing: rowDob, document: dob });
  }
  return {
    type,
    id: String(row.id),
    clinicalRecordId: type === "clinical_record" ? Number(row.id) : null,
    recordCode: row.record_code || null,
    patientId: row.patient_id || null,
    patientCategory: row.patient_category || null,
    fullName: `${row.first_name || ""} ${row.last_name || ""}`.trim(),
    email: row.email || "",
    phone: row.phone || "",
    dateOfBirth: rowDob || null,
    gender: row.gender || "",
    accountStatus:
      type === "account"
        ? patientData.normalizeAccountStatus({ status: row.status, isVerified: row.is_verified })
        : null,
    reasons,
    score,
    differences,
    likely: score >= 40,
  };
}

/**
 * Confirm & save. Maps the reviewed fields onto the canonical patient record:
 *   - link: { type: "account", id } | { type: "clinical_record", id } → attach to that patient,
 *     applying only the Admin-approved `applyFields` to the existing record.
 *   - createNew: true → new clinical record (Patient ID generated by the backend now).
 * Never verifies an account.
 */
async function confirmSession(db, sessionId, { admin, link = null, createNew = false, applyFields = [] }, uploadDirectory) {
  const client = await db.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    const sessionRow = await loadSessionRow(client, sessionId, { forUpdate: true });
    if (sessionRow.status === "saved") throw httpError("This intake was already saved to a patient record.", 409);
    if (sessionRow.status !== "draft") throw httpError("This intake session is closed.", 409);

    const fields = sessionRow.fields || intakeFields.emptyIntakeFields();
    const validation = intakeFields.validateIntakeFields(fields, {
      categoryConfirmed: Boolean(sessionRow.category_confirmed),
    });
    if (!validation.valid) {
      throw httpError("Complete the required patient information before saving.", 400, {
        code: "VALIDATION",
        validation,
      });
    }
    if ((sessionRow.conflicts || []).length) {
      throw httpError("Resolve the flagged document conflicts before saving.", 400, {
        code: "CONFLICTS",
        conflicts: sessionRow.conflicts,
      });
    }

    const values = intakeFields.fieldValues(fields);
    const matches = await findPatientMatches(client, fields);
    if (!link && !createNew) {
      if (matches.length) {
        throw httpError("Possible existing patient found. Choose the matching patient or confirm a new record.", 409, {
          code: "POSSIBLE_DUPLICATE",
          matches,
        });
      }
      throw httpError("Confirm that this is a new patient before saving.", 409, {
        code: "CONFIRM_NEW",
        matches: [],
      });
    }

    let clinicalRecord = null;
    let linkedUserId = null;
    let created = false;
    const actor = { id: admin.id, role: "admin" };

    if (link && link.type === "account") {
      linkedUserId = String(link.id);
      clinicalRecord = await applyToAccount(client, linkedUserId, values, applyFields, actor);
    } else if (link && link.type === "clinical_record") {
      const recordId = Number(link.id);
      const detail = await clinicalPatients.getClinicalRecord(client, recordId);
      if (!detail) throw httpError("The selected patient record no longer exists.", 404);
      linkedUserId = detail.record.linkedUserId ? String(detail.record.linkedUserId) : null;
      if (linkedUserId) {
        clinicalRecord = await applyToAccount(client, linkedUserId, values, applyFields, actor);
      } else {
        const { patientCategory, ...updates } = pickApplied(values, applyFields);
        clinicalRecord = Object.keys(updates).length
          ? await clinicalPatients.updateClinicalRecord(client, recordId, updates, actor)
          : detail.record;
        if (patientCategory) {
          const categorized = await client.query(
            `UPDATE clinic_patient_records SET patient_category = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING patient_category`,
            [patientIds.normalizeCategory(patientCategory), recordId]
          );
          clinicalRecord = { ...clinicalRecord, patientCategory: categorized.rows[0]?.patient_category || patientCategory };
        }
      }
    } else {
      clinicalRecord = await clinicalPatients.createClinicalRecord(
        client,
        intakeFields.toClinicalRecordInput(fields),
        actor
      );
      linkedUserId = clinicalRecord.linkedUserId ? String(clinicalRecord.linkedUserId) : null;
      created = true;
    }

    const patientId = clinicalRecord?.patientId || null;

    await client.query(
      `UPDATE patient_documents
       SET clinical_record_id = $1, linked_user_id = $2, patient_id = $3,
           status = CASE WHEN status = 'processed' THEN 'attached' ELSE status END,
           updated_at = CURRENT_TIMESTAMP
       WHERE session_id = $4`,
      [clinicalRecord?.id || null, linkedUserId, patientId, sessionId]
    );

    const saved = await client.query(
      `UPDATE admin_patient_intake_sessions
       SET status = 'saved', linked_user_id = $1, clinical_record_id = $2, patient_id = $3,
           saved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [linkedUserId, clinicalRecord?.id || null, patientId, sessionId]
    );

    await client.query("COMMIT");
    open = false;

    const documents = await loadDocuments(db, sessionId, uploadDirectory);
    return {
      session: mapSession(saved.rows[0], documents),
      record: clinicalRecord,
      createdNewPatient: created,
      linkedUserId,
      patientId,
    };
  } catch (error) {
    if (open) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function pickApplied(values, applyFields) {
  const allowed = new Set(Array.isArray(applyFields) ? applyFields : []);
  const updates = {};
  if (allowed.has("firstName") && values.firstName) updates.firstName = values.firstName;
  if (allowed.has("lastName") && values.lastName) updates.lastName = values.lastName;
  if (allowed.has("phone") && values.phone) updates.phone = values.phone;
  if (allowed.has("email") && values.email) updates.email = values.email;
  if (allowed.has("dateOfBirth") && values.dateOfBirth) updates.dateOfBirth = values.dateOfBirth;
  if (allowed.has("sex") && values.sex) updates.gender = values.sex;
  if (allowed.has("address") && values.address) updates.address = values.address;
  if (allowed.has("patientCategory") && values.patientCategory) updates.patientCategory = values.patientCategory;
  return updates;
}

/**
 * Attach intake to an existing patient ACCOUNT. The account/profile is the source of
 * truth, so Admin-approved fields are written there; the linked clinical record is
 * found or created and reads the profile automatically through enrichRecordsFromLinkedProfiles.
 */
async function applyToAccount(db, userId, values, applyFields, actor) {
  const updates = pickApplied(values, applyFields);

  const userSets = [];
  const userParams = [];
  if (updates.firstName) { userParams.push(updates.firstName); userSets.push(`first_name = $${userParams.length}`); }
  if (updates.lastName) { userParams.push(updates.lastName); userSets.push(`last_name = $${userParams.length}`); }
  if (updates.phone) { userParams.push(updates.phone); userSets.push(`phone = $${userParams.length}`); }
  if (updates.email) { userParams.push(updates.email); userSets.push(`email = $${userParams.length}`); }
  if (updates.patientCategory) {
    userParams.push(patientIds.normalizeCategory(updates.patientCategory));
    userSets.push(`patient_category = $${userParams.length}`);
  }
  if (userSets.length) {
    userParams.push(userId);
    await db.query(
      `UPDATE users SET ${userSets.join(", ")} WHERE id::text = $${userParams.length} AND LOWER(role) = 'patient'`,
      userParams
    );
  }

  if (updates.dateOfBirth || updates.gender || updates.address) {
    try {
      await db.query(
        `INSERT INTO patient_portal_profiles (user_id, date_of_birth, gender, address)
         VALUES ($1, $2::date, $3, $4)
         ON CONFLICT (user_id) DO UPDATE SET
           date_of_birth = COALESCE(EXCLUDED.date_of_birth, patient_portal_profiles.date_of_birth),
           gender = COALESCE(EXCLUDED.gender, patient_portal_profiles.gender),
           address = COALESCE(EXCLUDED.address, patient_portal_profiles.address),
           updated_at = CURRENT_TIMESTAMP`,
        [userId, updates.dateOfBirth || null, updates.gender || null, updates.address || null]
      );
    } catch (error) {
      if (!isMissingRelation(error) && error?.code !== "42703") throw error;
    }
  }

  const record = await clinicalPatients.findOrCreateClinicalRecordForUser(db, userId, actor);
  const [enriched] = await clinicalPatients.enrichRecordsFromLinkedProfiles(db, [record]);
  return enriched || record;
}

async function cancelSession(db, sessionId, uploadDirectory) {
  const sessionRow = await loadSessionRow(db, sessionId);
  if (sessionRow.status === "saved") throw httpError("Saved intakes cannot be cancelled.", 409);
  const docs = await db.query(`SELECT stored_name FROM patient_documents WHERE session_id = $1`, [sessionId]);
  for (const row of docs.rows) discardTemporaryDocumentFile(uploadDirectory, row.stored_name);
  await db.query(`DELETE FROM patient_documents WHERE session_id = $1`, [sessionId]);
  const result = await db.query(
    `UPDATE admin_patient_intake_sessions SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
    [sessionId]
  );
  return mapSession(result.rows[0], []);
}

/** Documents attached to a canonical patient (by clinical record or account id). */
async function listPatientDocuments(db, { clinicalRecordId = null, userId = null }, uploadDirectory) {
  const result = await db.query(
    `SELECT * FROM patient_documents
     WHERE status = 'attached'
       AND (($1::bigint IS NOT NULL AND clinical_record_id = $1) OR ($2::text IS NOT NULL AND linked_user_id = $2))
     ORDER BY created_at DESC`,
    [clinicalRecordId, userId ? String(userId) : null]
  );
  return result.rows.map((row) => mapDocument(row, uploadDirectory));
}

module.exports = {
  isMissingRelation,
  mapDocument,
  mapSession,
  createSession,
  listSessions,
  getSession,
  processDocument,
  removeDocument,
  getDocumentFile,
  updateSessionFields,
  findPatientMatches,
  confirmSession,
  cancelSession,
  listPatientDocuments,
  resolveTempDocumentPath: (uploadDirectory, name) => resolveTempDocumentPath(uploadDirectory, name),
  ensureUploadDirectory: (uploadDirectory) => fs.mkdirSync(uploadDirectory, { recursive: true }),
  documentPath: (uploadDirectory, storedName) => path.join(uploadDirectory, storedName),
};
