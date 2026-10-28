"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { loadClinicProfile } = require("./clinicAssistant");
const { writeAdminAudit } = require("./adminAudit");
const { renderAuthorizationPdf } = require("./dentalAuthorizationPdf");

const STATUSES = ["draft", "awaiting_signature", "signed", "superseded", "voided"];
const ALLOWED_MIME = new Set(["application/pdf", "image/jpeg", "image/png"]);
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const DEFAULT_UPLOAD_DIR = path.join(process.cwd(), "uploads", "dental-authorizations");

const TEMPLATE_TEXT = {
  explanation:
    "Your treating dentist has recommended the dental procedure named in this form. This document explains the proposed care in general terms so you can decide whether to authorize it. It is not a diagnosis, a guarantee of results, or a substitute for a discussion with your dentist. Procedure-specific details, risks, and alternatives must be reviewed with the treating dentist before you sign.",
  expectedBenefits:
    "The proposed procedure is intended to address the dental concern discussed with you and to support oral health, function, and/or appearance as clinically appropriate. Individual results vary. No specific outcome is guaranteed.",
  materialRisks:
    "All dental procedures carry material risks. Depending on the procedure and your health, these may include pain, swelling, bleeding, infection, delayed healing, injury to adjacent teeth or soft tissues, incomplete resolution of the original problem, the need for additional or alternative treatment, and, rarely, more serious complications. This general template does not list every possible risk of every dental treatment. The treating dentist will discuss the material risks that apply to the specifically named procedure.",
  alternatives:
    "Relevant alternatives may include watching and waiting, postponing treatment, choosing a different procedure, or declining treatment. Each option has its own benefits, limitations, and risks. Ask the treating dentist to explain the alternatives that apply to your situation, including the option to decline or postpone care.",
  questionsOpportunity:
    "You have had, or will have before signing, an opportunity to ask questions about the proposed procedure, its expected benefits, material risks, and alternatives, including declining or postponing treatment.",
  voluntaryAuthorization:
    "I voluntarily authorize the treating dentist and authorized clinic personnel to perform the specifically named dental procedure described in this document, including measures reasonably necessary to complete it safely. This authorization applies only to the procedure described here and does not automatically cover additional unrelated treatments.",
  withdrawalStatement:
    "I understand that I may withdraw this consent before or during treatment, subject to clinical and safety considerations already underway. Withdrawal does not affect care already provided.",
  understandingConfirmation:
    "By signing, I confirm that I have had an opportunity to understand this information, that my questions have been answered to my satisfaction, and that I am signing voluntarily. Generating or uploading this form does not, by itself, constitute legally sufficient informed consent until it has been reviewed with the treating dentist and signed by the patient or an authorized representative.",
};

function HttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function stringValue(value, maxLength = 2000) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function numericId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function isIsoDate(value) {
  const text = normalizeDate(value);
  if (!text) return false;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

function normalizeDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return null;
}

function actorName(actor) {
  if (!actor) return null;
  const name = `${actor.first_name || actor.firstName || ""} ${actor.last_name || actor.lastName || ""}`.trim();
  return name || actor.email || String(actor.id || "");
}

function canRecordSignature(role) {
  return role === "admin" || role === "dentist";
}

function canVoid(role) {
  return role === "admin" || role === "dentist";
}

function canManage(role) {
  return role === "admin" || role === "dentist" || role === "staff";
}

function isTerminalStatus(status) {
  return status === "superseded" || status === "voided";
}

function looksLikePdf(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

function looksLikeJpeg(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function looksLikePng(buffer) {
  return (
    Buffer.isBuffer(buffer) &&
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  );
}

function validateAuthorizationUpload({ mimeType, byteSize, buffer, originalName } = {}) {
  const mime = String(mimeType || "").toLowerCase();
  const name = String(originalName || "");
  if (name.includes("..") || name.includes("/") || name.includes("\\")) {
    throw HttpError(400, "The uploaded file name is not valid.");
  }
  if (!ALLOWED_MIME.has(mime)) {
    throw HttpError(400, "Only PDF, JPG, and PNG authorization files are accepted.");
  }
  const size = Number(byteSize);
  if (!Number.isFinite(size) || size <= 0) {
    throw HttpError(400, "The uploaded file is empty.");
  }
  if (size > MAX_UPLOAD_BYTES) {
    throw HttpError(400, "Authorization files must be 5 MB or smaller.");
  }
  if (buffer) {
    if (mime === "application/pdf" && !looksLikePdf(buffer)) {
      throw HttpError(400, "The uploaded file is not a valid PDF.");
    }
    if (mime === "image/jpeg" && !looksLikeJpeg(buffer)) {
      throw HttpError(400, "The uploaded file is not a valid JPEG image.");
    }
    if (mime === "image/png" && !looksLikePng(buffer)) {
      throw HttpError(400, "The uploaded file is not a valid PNG image.");
    }
  }
  return { mimeType: mime, byteSize: size };
}

function statusAfterUpload({ currentStatus, signedCopyConfirmed, actorRole }) {
  if (isTerminalStatus(currentStatus)) {
    throw HttpError(409, "This authorization can no longer accept a replacement upload.");
  }
  if (signedCopyConfirmed) {
    if (!canRecordSignature(actorRole)) {
      throw HttpError(
        403,
        "Only a dentist or administrator can record that a signed authorization was received."
      );
    }
    return "signed";
  }
  if (currentStatus === "signed") {
    return "signed";
  }
  return currentStatus || "draft";
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    documentNumber: row.document_number,
    clinicalRecordId: row.clinical_record_id,
    linkedUserId: row.linked_user_id || null,
    appointmentId: row.appointment_id != null ? Number(row.appointment_id) : null,
    treatmentId: row.treatment_id != null ? Number(row.treatment_id) : null,
    version: Number(row.version || 1),
    status: row.status,
    supersedesId: row.supersedes_id || null,
    supersededById: row.superseded_by_id || null,
    patientFullName: row.patient_full_name,
    patientClinicId: row.patient_clinic_id || null,
    patientDateOfBirth: row.patient_date_of_birth || null,
    patientAge: row.patient_age || null,
    patientPhone: row.patient_phone || null,
    procedureName: row.procedure_name,
    toothOrArea: row.tooth_or_area || null,
    treatingDentist: row.treating_dentist || null,
    plannedProcedureDate: row.planned_procedure_date || null,
    clinicalNotes: row.clinical_notes || null,
    explanation: row.explanation,
    expectedBenefits: row.expected_benefits,
    materialRisks: row.material_risks,
    alternatives: row.alternatives,
    questionsOpportunity: row.questions_opportunity,
    voluntaryAuthorization: row.voluntary_authorization,
    withdrawalStatement: row.withdrawal_statement,
    understandingConfirmation: row.understanding_confirmation,
    patientOrRepresentativeName: row.patient_or_representative_name || null,
    representativeRelationship: row.representative_relationship || null,
    patientSignedAt: row.patient_signed_at || null,
    dentistName: row.dentist_name || null,
    dentistSignedAt: row.dentist_signed_at || null,
    witnessName: row.witness_name || null,
    guardianName: row.guardian_name || null,
    consentRecordedAt: row.consent_recorded_at || null,
    consentRecordedBy: row.consent_recorded_by || null,
    consentRecordedByRole: row.consent_recorded_by_role || null,
    originalName: row.original_name || null,
    storedName: row.stored_name || null,
    mimeType: row.mime_type || null,
    byteSize: row.byte_size != null ? Number(row.byte_size) : null,
    hasUpload: Boolean(row.stored_name),
    uploadContainsSignature: Boolean(row.upload_contains_signature),
    uploadedAt: row.uploaded_at || null,
    uploadedBy: row.uploaded_by || null,
    uploadedByRole: row.uploaded_by_role || null,
    createdBy: row.created_by || null,
    createdByRole: row.created_by_role || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function ensureUploadDir(directory = DEFAULT_UPLOAD_DIR) {
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function resolveStoredPath(uploadDirectory, storedName) {
  if (!storedName) return null;
  const root = path.resolve(uploadDirectory);
  const filePath = path.resolve(root, storedName);
  if (path.dirname(filePath) !== root) {
    return null;
  }
  return filePath;
}

async function loadClinicalRecord(db, clinicalRecordId) {
  const result = await db.query(
    `SELECT
       id, record_code, first_name, last_name, phone, date_of_birth, linked_user_id, patient_id,
       DATE_PART('year', AGE(CURRENT_DATE, date_of_birth))::int AS age
     FROM clinic_patient_records
     WHERE id = $1
       AND COALESCE(is_archived, FALSE) = FALSE
     LIMIT 1`,
    [clinicalRecordId]
  );
  return result.rows[0] || null;
}

async function assertStaffAccess(role, db, clinicalRecordId, linkedUserId) {
  if (role === "patient") {
    if (!linkedUserId) {
      throw HttpError(404, "Authorization document not found.");
    }
    return;
  }
  if (!canManage(role)) {
    throw HttpError(403, "You are not allowed to manage authorization documents.");
  }
  const record = await loadClinicalRecord(db, clinicalRecordId);
  if (!record) {
    throw HttpError(404, "Patient record not found.");
  }
  return record;
}

async function nextDocumentNumber(db) {
  const year = new Date().getFullYear();
  const prefix = `ADC-AUTH-${year}-`;
  const result = await db.query(
    `SELECT document_number
     FROM dental_procedure_authorizations
     WHERE document_number LIKE $1
     ORDER BY document_number DESC
     LIMIT 1`,
    [`${prefix}%`]
  );
  const last = result.rows[0]?.document_number || "";
  const serial = Number.parseInt(String(last).slice(prefix.length), 10);
  const next = Number.isFinite(serial) ? serial + 1 : 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

function snapshotFromRecord(record, body = {}) {
  const fullName =
    stringValue(body.patientFullName, 160) ||
    `${record.first_name || ""} ${record.last_name || ""}`.trim();
  const procedureName = stringValue(body.procedureName, 200);
  if (!fullName) {
    throw HttpError(400, "A patient name is required.");
  }
  if (!procedureName) {
    throw HttpError(400, "A procedure or treatment name is required.");
  }
  const planned = normalizeDate(body.plannedProcedureDate);
  if (body.plannedProcedureDate && !planned) {
    throw HttpError(400, "Provide a valid planned procedure date.");
  }
  return {
    patientFullName: fullName,
    patientClinicId:
      stringValue(body.patientClinicId, 40) || record.patient_id || record.record_code || String(record.id),
    patientDateOfBirth: record.date_of_birth || null,
    patientAge:
      stringValue(body.patientAge, 12) ||
      (record.age != null ? String(record.age) : null),
    patientPhone: stringValue(body.patientPhone, 40) || record.phone || null,
    procedureName,
    toothOrArea: stringValue(body.toothOrArea, 80),
    treatingDentist: stringValue(body.treatingDentist, 160),
    plannedProcedureDate: planned || null,
    clinicalNotes: stringValue(body.clinicalNotes, 2000),
    explanation: stringValue(body.explanation, 4000) || TEMPLATE_TEXT.explanation,
    expectedBenefits: stringValue(body.expectedBenefits, 4000) || TEMPLATE_TEXT.expectedBenefits,
    materialRisks: stringValue(body.materialRisks, 4000) || TEMPLATE_TEXT.materialRisks,
    alternatives: stringValue(body.alternatives, 4000) || TEMPLATE_TEXT.alternatives,
    questionsOpportunity: stringValue(body.questionsOpportunity, 2000) || TEMPLATE_TEXT.questionsOpportunity,
    voluntaryAuthorization: stringValue(body.voluntaryAuthorization, 2000) || TEMPLATE_TEXT.voluntaryAuthorization,
    withdrawalStatement: stringValue(body.withdrawalStatement, 2000) || TEMPLATE_TEXT.withdrawalStatement,
    understandingConfirmation:
      stringValue(body.understandingConfirmation, 2000) || TEMPLATE_TEXT.understandingConfirmation,
    dentistName: stringValue(body.dentistName, 160) || stringValue(body.treatingDentist, 160),
    witnessName: stringValue(body.witnessName, 160),
    guardianName: stringValue(body.guardianName, 160),
    appointmentId: numericId(body.appointmentId),
    treatmentId: numericId(body.treatmentId),
  };
}

async function audit(db, actor, action, document, detail) {
  await writeAdminAudit(db, {
    actorId: actor?.id,
    actorName: actorName(actor),
    actorRole: actor?.role || actor?.actorRole,
    action,
    targetType: "dental_authorization",
    targetId: document?.id,
    targetLabel: document?.document_number || document?.documentNumber || null,
    result: "success",
    detail,
  });
}

async function listForClinicalRecord(db, clinicalRecordId) {
  const result = await db.query(
    `SELECT *
     FROM dental_procedure_authorizations
     WHERE clinical_record_id = $1
     ORDER BY created_at DESC`,
    [clinicalRecordId]
  );
  return result.rows.map(mapRow);
}

async function listForPatientUser(db, userId) {
  const result = await db.query(
    `SELECT *
     FROM dental_procedure_authorizations
     WHERE linked_user_id = $1
     ORDER BY created_at DESC`,
    [String(userId)]
  );
  return result.rows.map(mapRow);
}

async function getById(db, id) {
  const result = await db.query(`SELECT * FROM dental_procedure_authorizations WHERE id = $1 LIMIT 1`, [id]);
  return result.rows[0] || null;
}

function assertVisibleTo(role, actorUserId, row) {
  if (role === "patient") {
    if (!row.linked_user_id || String(row.linked_user_id) !== String(actorUserId)) {
      throw HttpError(404, "Authorization document not found.");
    }
    return;
  }
  if (!canManage(role)) {
    throw HttpError(403, "You are not allowed to access authorization documents.");
  }
}

async function createAuthorization(db, { clinicalRecordId, body, actor, role }) {
  if (!canManage(role)) {
    throw HttpError(403, "You are not allowed to generate authorization documents.");
  }
  const record = await loadClinicalRecord(db, clinicalRecordId);
  if (!record) {
    throw HttpError(404, "Patient record not found.");
  }
  const snapshot = snapshotFromRecord(record, body);
  if (role === "dentist" && !snapshot.treatingDentist) {
    snapshot.treatingDentist = actorName(actor);
    snapshot.dentistName = snapshot.dentistName || snapshot.treatingDentist;
  }
  const id = crypto.randomUUID();
  const documentNumber = await nextDocumentNumber(db);
  const inserted = await db.query(
    `INSERT INTO dental_procedure_authorizations (
       id, document_number, clinical_record_id, linked_user_id, appointment_id, treatment_id,
       version, status, patient_full_name, patient_clinic_id, patient_date_of_birth, patient_age,
       patient_phone, procedure_name, tooth_or_area, treating_dentist, planned_procedure_date,
       clinical_notes, explanation, expected_benefits, material_risks, alternatives,
       questions_opportunity, voluntary_authorization, withdrawal_statement,
       understanding_confirmation, dentist_name, witness_name, guardian_name,
       created_by, created_by_role
     ) VALUES (
       $1,$2,$3,$4,$5,$6,1,'draft',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29
     ) RETURNING *`,
    [
      id,
      documentNumber,
      record.id,
      record.linked_user_id || null,
      snapshot.appointmentId,
      snapshot.treatmentId,
      snapshot.patientFullName,
      snapshot.patientClinicId,
      snapshot.patientDateOfBirth,
      snapshot.patientAge,
      snapshot.patientPhone,
      snapshot.procedureName,
      snapshot.toothOrArea,
      snapshot.treatingDentist,
      snapshot.plannedProcedureDate,
      snapshot.clinicalNotes,
      snapshot.explanation,
      snapshot.expectedBenefits,
      snapshot.materialRisks,
      snapshot.alternatives,
      snapshot.questionsOpportunity,
      snapshot.voluntaryAuthorization,
      snapshot.withdrawalStatement,
      snapshot.understandingConfirmation,
      snapshot.dentistName,
      snapshot.witnessName,
      snapshot.guardianName,
      String(actor.id),
      role,
    ]
  );
  const row = inserted.rows[0];
  await audit(db, { ...actor, role }, "authorization.generated", row, "Generated dental procedure authorization template.");
  return mapRow(row);
}

async function issueForSignature(db, { id, actor, role }) {
  if (!canManage(role)) {
    throw HttpError(403, "You are not allowed to issue this authorization.");
  }
  const row = await getById(db, id);
  if (!row) throw HttpError(404, "Authorization document not found.");
  if (row.status !== "draft" && row.status !== "awaiting_signature") {
    throw HttpError(409, "Only a draft authorization can be issued for signature.");
  }
  const updated = await db.query(
    `UPDATE dental_procedure_authorizations
     SET status = 'awaiting_signature', updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING *`,
    [id]
  );
  await audit(db, { ...actor, role }, "authorization.issued", updated.rows[0], "Issued authorization for patient signature.");
  return mapRow(updated.rows[0]);
}

async function recordSignature(db, { id, actor, role, body }) {
  if (!canRecordSignature(role)) {
    throw HttpError(403, "Only a dentist or administrator can record a signed authorization.");
  }
  const row = await getById(db, id);
  if (!row) throw HttpError(404, "Authorization document not found.");
  if (isTerminalStatus(row.status)) {
    throw HttpError(409, "This authorization can no longer be signed.");
  }
  const signerName = stringValue(body?.patientOrRepresentativeName, 160);
  if (!signerName) {
    throw HttpError(400, "Record the name of the patient or authorized representative who signed.");
  }
  const dentistName = stringValue(body?.dentistName, 160) || row.dentist_name || row.treating_dentist || actorName(actor);
  const updated = await db.query(
    `UPDATE dental_procedure_authorizations
     SET status = 'signed',
         patient_or_representative_name = $2,
         representative_relationship = $3,
         patient_signed_at = COALESCE($4::timestamptz, CURRENT_TIMESTAMP),
         dentist_name = $5,
         dentist_signed_at = COALESCE($6::timestamptz, CURRENT_TIMESTAMP),
         witness_name = COALESCE($7, witness_name),
         guardian_name = COALESCE($8, guardian_name),
         consent_recorded_at = CURRENT_TIMESTAMP,
         consent_recorded_by = $9,
         consent_recorded_by_role = $10,
         upload_contains_signature = CASE WHEN stored_name IS NOT NULL THEN TRUE ELSE upload_contains_signature END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING *`,
    [
      id,
      signerName,
      stringValue(body?.representativeRelationship, 80),
      stringValue(body?.signedAt, 40),
      dentistName,
      stringValue(body?.dentistSignedAt, 40),
      stringValue(body?.witnessName, 160),
      stringValue(body?.guardianName, 160),
      String(actor.id),
      role,
    ]
  );
  await audit(db, { ...actor, role }, "authorization.signed", updated.rows[0], "Recorded authorized signature on dental procedure authorization.");
  return mapRow(updated.rows[0]);
}

async function voidAuthorization(db, { id, actor, role, reason }) {
  if (!canVoid(role)) {
    throw HttpError(403, "Only a dentist or administrator can void an authorization.");
  }
  const row = await getById(db, id);
  if (!row) throw HttpError(404, "Authorization document not found.");
  if (row.status === "voided") {
    return mapRow(row);
  }
  const updated = await db.query(
    `UPDATE dental_procedure_authorizations
     SET status = 'voided', updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING *`,
    [id]
  );
  const detail = stringValue(reason, 200) || "Authorization voided; historical record retained.";
  await audit(db, { ...actor, role }, "authorization.voided", updated.rows[0], detail);
  return mapRow(updated.rows[0]);
}

async function saveUpload(db, { id, actor, role, file, signedCopyConfirmed, uploadDirectory }) {
  if (!canManage(role)) {
    throw HttpError(403, "You are not allowed to upload authorization documents.");
  }
  const row = await getById(db, id);
  if (!row) throw HttpError(404, "Authorization document not found.");
  if (!file) {
    throw HttpError(400, "Choose a PDF, JPG, or PNG authorization document.");
  }
  let buffer = null;
  if (file.buffer) buffer = file.buffer;
  else if (file.path) {
    buffer = fs.readFileSync(file.path);
  }
  validateAuthorizationUpload({
    mimeType: file.mimetype,
    byteSize: file.size,
    buffer,
    originalName: file.originalname,
  });
  const nextStatus = statusAfterUpload({
    currentStatus: row.status,
    signedCopyConfirmed: Boolean(signedCopyConfirmed),
    actorRole: role,
  });
  const directory = ensureUploadDir(uploadDirectory);
  const storedName = `${crypto.randomUUID()}${path.extname(file.originalname || "").toLowerCase()}`;
  const dest = path.join(directory, storedName);
  if (file.path) {
    fs.copyFileSync(file.path, dest);
  } else {
    fs.writeFileSync(dest, buffer);
  }

  const previousStored = row.stored_name;
  const updated = await db.query(
    `UPDATE dental_procedure_authorizations
     SET original_name = $2,
         stored_name = $3,
         mime_type = $4,
         byte_size = $5,
         uploaded_at = CURRENT_TIMESTAMP,
         uploaded_by = $6,
         uploaded_by_role = $7,
         upload_contains_signature = $8,
         status = $9,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING *`,
    [
      id,
      String(file.originalname || "authorization").slice(0, 180),
      storedName,
      file.mimetype,
      file.size,
      String(actor.id),
      role,
      Boolean(signedCopyConfirmed) && canRecordSignature(role),
      nextStatus,
    ]
  );
  if (previousStored && previousStored !== storedName) {
    const oldPath = resolveStoredPath(directory, previousStored);
    if (oldPath && fs.existsSync(oldPath) && row.status !== "signed") {
      fs.unlink(oldPath, () => {});
    }
  }
  await audit(
    db,
    { ...actor, role },
    "authorization.uploaded",
    updated.rows[0],
    signedCopyConfirmed
      ? "Uploaded a signed authorization copy."
      : "Uploaded an authorization file without recording a signature."
  );
  return mapRow(updated.rows[0]);
}

async function replaceWithNewVersion(db, { id, actor, role, body }) {
  if (!canManage(role)) {
    throw HttpError(403, "You are not allowed to replace this authorization.");
  }
  const row = await getById(db, id);
  if (!row) throw HttpError(404, "Authorization document not found.");
  if (row.status === "voided") {
    throw HttpError(409, "A voided authorization cannot be replaced.");
  }
  const record = await loadClinicalRecord(db, row.clinical_record_id);
  if (!record) throw HttpError(404, "Patient record not found.");
  const snapshot = snapshotFromRecord(record, {
    patientFullName: body?.patientFullName || row.patient_full_name,
    patientClinicId: body?.patientClinicId || row.patient_clinic_id,
    patientAge: body?.patientAge || row.patient_age,
    patientPhone: body?.patientPhone || row.patient_phone,
    procedureName: body?.procedureName || row.procedure_name,
    toothOrArea: body?.toothOrArea ?? row.tooth_or_area,
    treatingDentist: body?.treatingDentist || row.treating_dentist,
    plannedProcedureDate: body?.plannedProcedureDate || row.planned_procedure_date || null,
    clinicalNotes: body?.clinicalNotes ?? row.clinical_notes,
    explanation: body?.explanation || row.explanation,
    expectedBenefits: body?.expectedBenefits || row.expected_benefits,
    materialRisks: body?.materialRisks || row.material_risks,
    alternatives: body?.alternatives || row.alternatives,
    appointmentId: body?.appointmentId ?? row.appointment_id,
    treatmentId: body?.treatmentId ?? row.treatment_id,
    dentistName: body?.dentistName || row.dentist_name,
    witnessName: body?.witnessName || row.witness_name,
    guardianName: body?.guardianName || row.guardian_name,
  });
  const newId = crypto.randomUUID();
  const documentNumber = await nextDocumentNumber(db);
  const inserted = await db.query(
    `INSERT INTO dental_procedure_authorizations (
       id, document_number, clinical_record_id, linked_user_id, appointment_id, treatment_id,
       version, status, supersedes_id, patient_full_name, patient_clinic_id, patient_date_of_birth,
       patient_age, patient_phone, procedure_name, tooth_or_area, treating_dentist, planned_procedure_date,
       clinical_notes, explanation, expected_benefits, material_risks, alternatives,
       questions_opportunity, voluntary_authorization, withdrawal_statement,
       understanding_confirmation, dentist_name, witness_name, guardian_name,
       created_by, created_by_role
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,'draft',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31
     ) RETURNING *`,
    [
      newId,
      documentNumber,
      record.id,
      record.linked_user_id || row.linked_user_id || null,
      snapshot.appointmentId,
      snapshot.treatmentId,
      Number(row.version || 1) + 1,
      row.id,
      snapshot.patientFullName,
      snapshot.patientClinicId,
      snapshot.patientDateOfBirth,
      snapshot.patientAge,
      snapshot.patientPhone,
      snapshot.procedureName,
      snapshot.toothOrArea,
      snapshot.treatingDentist,
      snapshot.plannedProcedureDate,
      snapshot.clinicalNotes,
      snapshot.explanation,
      snapshot.expectedBenefits,
      snapshot.materialRisks,
      snapshot.alternatives,
      snapshot.questionsOpportunity,
      snapshot.voluntaryAuthorization,
      snapshot.withdrawalStatement,
      snapshot.understandingConfirmation,
      snapshot.dentistName,
      snapshot.witnessName,
      snapshot.guardianName,
      String(actor.id),
      role,
    ]
  );
  await db.query(
    `UPDATE dental_procedure_authorizations
     SET status = 'superseded', superseded_by_id = $2, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [row.id, newId]
  );
  await audit(
    db,
    { ...actor, role },
    "authorization.superseded",
    row,
    "Prior authorization retained and marked superseded; a new version was created."
  );
  return mapRow(inserted.rows[0]);
}

async function buildPdf(db, row) {
  const clinic = await loadClinicProfile(db);
  return renderAuthorizationPdf({ clinic, document: mapRow(row) });
}

module.exports = {
  STATUSES,
  ALLOWED_MIME,
  MAX_UPLOAD_BYTES,
  DEFAULT_UPLOAD_DIR,
  TEMPLATE_TEXT,
  HttpError,
  canRecordSignature,
  canVoid,
  canManage,
  validateAuthorizationUpload,
  statusAfterUpload,
  mapRow,
  ensureUploadDir,
  resolveStoredPath,
  loadClinicalRecord,
  assertStaffAccess,
  assertVisibleTo,
  listForClinicalRecord,
  listForPatientUser,
  getById,
  createAuthorization,
  issueForSignature,
  recordSignature,
  voidAuthorization,
  saveUpload,
  replaceWithNewVersion,
  buildPdf,
  actorName,
};
