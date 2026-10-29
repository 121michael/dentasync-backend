"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { generatePrescriptionPdf, rasterizePrescriptionPdf } = require("./prescriptionPdf");
const { sendMailMessage, emailDeliveryIsConfigured } = require("./emailDelivery");
const { withPrescriptionSchema } = require("./prescriptionSchema");

const DEFAULT_UPLOAD_DIR = path.join(process.cwd(), "uploads", "prescriptions");
const WORKFLOW = {
  DRAFT: "draft",
  SENT_TO_STAFF: "sent_to_staff",
  PROCESSING: "processing",
  RETURNED: "returned_to_dentist",
  AUTHORIZED: "authorized",
  CANCELLED: "cancelled",
};
const EMAIL_STATUS = {
  PENDING: "pending",
  SENDING: "sending",
  SENT: "sent",
  FAILED: "failed",
  BOUNCED: "bounced",
  UNKNOWN: "unknown",
};
const CLINICAL_EDITABLE = new Set([WORKFLOW.DRAFT, WORKFLOW.RETURNED]);
const STAFF_QUEUE = new Set([WORKFLOW.SENT_TO_STAFF, WORKFLOW.PROCESSING, WORKFLOW.AUTHORIZED]);
const PATIENT_VISIBLE = new Set([WORKFLOW.SENT_TO_STAFF, WORKFLOW.PROCESSING, WORKFLOW.AUTHORIZED]);

function patientWorkflowLabel(status) {
  if (status === WORKFLOW.SENT_TO_STAFF) return "Pending Authorization";
  if (status === WORKFLOW.AUTHORIZED) return "Authorized";
  if (status === WORKFLOW.PROCESSING) return "Processing";
  return String(status || "").replace(/_/g, " ");
}

function patientEmailLabel(status) {
  if (status === EMAIL_STATUS.SENT) return "Sent";
  if (status === EMAIL_STATUS.FAILED || status === EMAIL_STATUS.BOUNCED) return "Email Failed";
  if (status === EMAIL_STATUS.SENDING) return "Sending";
  if (status === EMAIL_STATUS.PENDING) return "Email pending";
  return String(status || "").replace(/_/g, " ");
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function stringValue(value, maxLength = 500) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeEmail(value) {
  const email = stringValue(value, 254)?.toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function maskEmail(value) {
  const email = normalizeEmail(value);
  if (!email) return "—";
  const [local, domain] = email.split("@");
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}

function numericId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function normalizeItem(raw, index) {
  const medicationName = stringValue(raw?.medicationName || raw?.medication_name, 160);
  const dosage = stringValue(raw?.dosage, 120);
  const quantity = stringValue(raw?.quantity, 80);
  const sig = stringValue(raw?.sig || raw?.instructions, 1000);
  if (!medicationName || !dosage || !quantity || !sig) {
    throw httpError(
      400,
      `Medication ${index + 1} needs a medicine name, quantity, dosage, and Sig / patient instructions.`
    );
  }
  return {
    sortOrder: index,
    medicationName,
    strength: stringValue(raw?.strength, 80),
    dosage,
    quantity,
    frequency: stringValue(raw?.frequency, 120) || "",
    duration: stringValue(raw?.duration, 120) || "",
    route: stringValue(raw?.route, 80),
    sig,
    additionalInstructions: stringValue(raw?.additionalInstructions || raw?.additional_instructions, 1000),
  };
}

function normalizeItems(rawItems) {
  if (!Array.isArray(rawItems) || !rawItems.length) {
    throw httpError(400, "Add at least one medication item. Medication is not suggested automatically.");
  }
  if (rawItems.length > 20) {
    throw httpError(400, "A prescription may include at most 20 medication items.");
  }
  return rawItems.map((item, index) => normalizeItem(item, index));
}

function clinicalPayload(items, clinicalNotes, includeExtractionAftercare) {
  return {
    items: items.map((item) => ({
      medicationName: item.medicationName,
      strength: item.strength || "",
      dosage: item.dosage,
      quantity: item.quantity,
      frequency: item.frequency,
      duration: item.duration,
      route: item.route || "",
      sig: item.sig,
      additionalInstructions: item.additionalInstructions || "",
    })),
    clinicalNotes: clinicalNotes || "",
    includeExtractionAftercare: Boolean(includeExtractionAftercare),
  };
}

function contentHash(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function dentistDisplayName(dentist) {
  const name = `${dentist.first_name || dentist.firstName || ""} ${dentist.last_name || dentist.lastName || ""}`.trim();
  return name ? `Dr. ${name}` : "Dentist";
}

function mapItem(row) {
  return {
    id: row.id,
    sortOrder: row.sort_order,
    medicationName: row.medication_name,
    strength: row.strength || "",
    dosage: row.dosage,
    quantity: row.quantity,
    frequency: row.frequency,
    duration: row.duration,
    route: row.route || "",
    sig: row.sig,
    additionalInstructions: row.additional_instructions || "",
  };
}

function mapAttempt(row) {
  return {
    id: row.id,
    status: row.status,
    intendedRecipientMasked: maskEmail(row.intended_recipient),
    attemptedAt: row.attempted_at,
    completedAt: row.completed_at,
    providerMessageId: row.provider_message_id || null,
    providerResult: row.provider_result || null,
    failureDetail: row.failure_detail || null,
  };
}

function serialize(row, extras = {}) {
  const snapshot = row.snapshot || {};
  return {
    id: row.id,
    prescriptionNumber: row.prescription_number,
    clinicalRecordId: row.clinical_record_id,
    linkedUserId: row.linked_user_id,
    appointmentId: row.appointment_id,
    treatmentId: row.treatment_id,
    currentVersion: row.current_version,
    workflowStatus: row.workflow_status,
    emailStatus: row.email_status,
    includeExtractionAftercare: Boolean(row.include_extraction_aftercare),
    returnReason: row.return_reason || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    patient: snapshot.patient || extras.patient || null,
    dentist: snapshot.dentist || extras.dentist || null,
    clinic: snapshot.clinic || extras.clinic || null,
    authorizedVersion: extras.authorizedVersion || row.authorized_version || null,
    authorizedAt: extras.authorizedAt || row.authorized_at || null,
    authorizedBy: extras.authorizedBy || row.authorized_by || null,
    authorizationMethod: extras.authorizationMethod || row.authorization_method || null,
    contentHash: extras.contentHash || row.content_hash || null,
    items: extras.items || [],
    clinicalNotes: extras.clinicalNotes ?? row.clinical_notes ?? "",
    versions: extras.versions || undefined,
    audit: extras.audit || undefined,
    emailAttempts: extras.emailAttempts || undefined,
    recipientEmailMasked: extras.recipientEmailMasked || maskEmail(snapshot.patient?.email),
    recipientEmail: extras.includeFullEmail ? snapshot.patient?.email || extras.patient?.email || null : undefined,
  };
}

async function audit(client, { prescriptionId, version, actorId, actorRole, action, detail }) {
  await client.query(
    `INSERT INTO prescription_audit_events (
       id, prescription_id, version, actor_id, actor_role, action, detail
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [crypto.randomUUID(), prescriptionId, version || null, actorId || null, actorRole || null, action, detail || null]
  );
}

async function nextPrescriptionNumber(client) {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `RX-${stamp}-`;
  const result = await client.query(
    `SELECT prescription_number
     FROM prescriptions
     WHERE prescription_number LIKE $1
     ORDER BY prescription_number DESC
     LIMIT 1`,
    [`${prefix}%`]
  );
  const last = result.rows[0]?.prescription_number;
  const seq = last ? Number.parseInt(last.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(Number.isFinite(seq) ? seq : 1).padStart(4, "0")}`;
}

async function loadClinic(db) {
  try {
    const result = await db.query(
      `SELECT setting_value FROM admin_portal_settings WHERE setting_key = 'clinic' LIMIT 1`
    );
    const saved = result.rows[0]?.setting_value || {};
    const name = stringValue(saved.name, 120) || "Amethyst Dental Clinic";
    const address = stringValue(saved.address, 300);
    const phone = stringValue(saved.phone, 40);
    const email = stringValue(saved.email, 160);
    return {
      name,
      address: address || "Grand Central Residences, Cityland, Sultan St., Highway Hills, Mandaluyong, Metro Manila",
      phone: phone || "09109207877",
      email: email || "amethystdental@gmail.com",
    };
  } catch (error) {
    if (error?.code === "42P01" || error?.code === "42703") {
      return {
        name: "Amethyst Dental Clinic",
        address: "Grand Central Residences, Cityland, Sultan St., Highway Hills, Mandaluyong, Metro Manila",
        phone: "09109207877",
        email: "amethystdental@gmail.com",
      };
    }
    throw error;
  }
}

async function loadPatientRecord(db, clinicalRecordId) {
  const result = await db.query(
    `SELECT
       id, record_code, first_name, last_name, email, phone, date_of_birth, gender, address,
       linked_user_id, patient_id
     FROM clinic_patient_records
     WHERE id = $1 AND COALESCE(is_archived, FALSE) = FALSE
     LIMIT 1`,
    [clinicalRecordId]
  );
  const row = result.rows[0];
  if (!row) throw httpError(404, "That patient record was not found.");
  const fullName = `${row.first_name || ""} ${row.last_name || ""}`.trim();
  let age = null;
  if (row.date_of_birth) {
    const birth = new Date(row.date_of_birth);
    if (!Number.isNaN(birth.getTime())) {
      const today = new Date();
      age = today.getFullYear() - birth.getFullYear();
      const hadBirthday =
        today.getMonth() > birth.getMonth() ||
        (today.getMonth() === birth.getMonth() && today.getDate() >= birth.getDate());
      if (!hadBirthday) age -= 1;
    }
  }
  return {
    id: row.id,
    recordCode: row.record_code,
    patientId: row.patient_id || row.record_code,
    fullName,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email || null,
    phone: row.phone || null,
    dateOfBirth: row.date_of_birth || null,
    age,
    sex: row.gender || null,
    address: row.address || null,
    linkedUserId: row.linked_user_id || null,
  };
}

async function treatmentSupportsAftercare(db, treatmentId) {
  if (!treatmentId) return false;
  const result = await db.query(
    `SELECT treatment FROM clinic_patient_treatments WHERE id = $1 LIMIT 1`,
    [treatmentId]
  );
  const name = String(result.rows[0]?.treatment || "").toLowerCase();
  return /extract|odontectomy/.test(name);
}

async function insertVersion(client, {
  prescriptionId,
  version,
  items,
  clinicalNotes,
  includeExtractionAftercare,
  patient,
  dentist,
  clinic,
  actorId,
  actorRole,
}) {
  const payload = clinicalPayload(items, clinicalNotes, includeExtractionAftercare);
  const hash = contentHash(payload);
  const versionId = crypto.randomUUID();
  const snapshot = {
    patient,
    dentist: {
      id: dentist.id,
      fullName: dentistDisplayName(dentist),
      specialization: dentist.specialization || "",
      email: dentist.email || "",
    },
    clinic,
    items: payload.items,
    clinicalNotes: payload.clinicalNotes,
    includeExtractionAftercare: payload.includeExtractionAftercare,
  };
  await client.query(
    `INSERT INTO prescription_versions (
       id, prescription_id, version, content_hash, snapshot, clinical_notes,
       created_by, created_by_role
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
    [versionId, prescriptionId, version, hash, JSON.stringify(snapshot), clinicalNotes, actorId, actorRole]
  );
  for (const item of items) {
    await client.query(
      `INSERT INTO prescription_items (
         id, version_id, sort_order, medication_name, strength, dosage, quantity,
         frequency, duration, route, sig, additional_instructions
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        crypto.randomUUID(),
        versionId,
        item.sortOrder,
        item.medicationName,
        item.strength,
        item.dosage,
        item.quantity,
        item.frequency,
        item.duration,
        item.route,
        item.sig,
        item.additionalInstructions,
      ]
    );
  }
  return { versionId, hash, snapshot };
}

async function loadDetail(db, prescriptionId) {
  const result = await db.query(
    `SELECT
       rx.*,
       ver.id AS version_row_id,
       ver.content_hash,
       ver.snapshot,
       ver.clinical_notes,
       ver.authorized_at,
       ver.authorized_by,
       ver.authorization_method,
       auth_ver.version AS authorized_version
     FROM prescriptions AS rx
     JOIN prescription_versions AS ver
       ON ver.prescription_id = rx.id AND ver.version = rx.current_version
     LEFT JOIN prescription_versions AS auth_ver
       ON auth_ver.prescription_id = rx.id
      AND auth_ver.authorized_at IS NOT NULL
      AND auth_ver.version = (
        SELECT MAX(inner_ver.version)
        FROM prescription_versions AS inner_ver
        WHERE inner_ver.prescription_id = rx.id AND inner_ver.authorized_at IS NOT NULL
      )
     WHERE rx.id = $1
     LIMIT 1`,
    [prescriptionId]
  );
  const row = result.rows[0];
  if (!row) throw httpError(404, "That prescription was not found.");
  const items = await db.query(
    `SELECT * FROM prescription_items WHERE version_id = $1 ORDER BY sort_order ASC`,
    [row.version_row_id]
  );
  const versions = await db.query(
    `SELECT id, version, content_hash, created_at, created_by_role, authorized_at, authorized_by, authorization_method
     FROM prescription_versions
     WHERE prescription_id = $1
     ORDER BY version DESC`,
    [prescriptionId]
  );
  const auditRows = await db.query(
    `SELECT action, actor_role, detail, created_at, version
     FROM prescription_audit_events
     WHERE prescription_id = $1
     ORDER BY created_at DESC
     LIMIT 40`,
    [prescriptionId]
  );
  const attempts = await db.query(
    `SELECT * FROM prescription_email_attempts
     WHERE prescription_id = $1
     ORDER BY attempted_at DESC
     LIMIT 20`,
    [prescriptionId]
  );
  return serialize(row, {
    items: items.rows.map(mapItem),
    clinicalNotes: row.clinical_notes,
    contentHash: row.content_hash,
    authorizedVersion: row.authorized_version,
    authorizedAt: row.authorized_at,
    authorizedBy: row.authorized_by,
    authorizationMethod: row.authorization_method,
    versions: versions.rows.map((item) => ({
      id: item.id,
      version: item.version,
      contentHash: item.content_hash,
      createdAt: item.created_at,
      createdByRole: item.created_by_role,
      authorizedAt: item.authorized_at,
      authorizedBy: item.authorized_by,
      authorizationMethod: item.authorization_method,
    })),
    audit: auditRows.rows.map((item) => ({
      action: item.action,
      actorRole: item.actor_role,
      detail: item.detail,
      createdAt: item.created_at,
      version: item.version,
    })),
    emailAttempts: attempts.rows.map(mapAttempt),
    recipientEmailMasked: maskEmail(row.snapshot?.patient?.email),
    includeFullEmail: false,
  });
}

async function listPrescriptions(db, { clinicalRecordId, workflowStatus, search } = {}) {
  const clauses = [];
  const params = [];
  if (clinicalRecordId) {
    params.push(clinicalRecordId);
    clauses.push(`rx.clinical_record_id = $${params.length}`);
  }
  if (workflowStatus) {
    params.push(workflowStatus);
    clauses.push(`rx.workflow_status = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    clauses.push(
      `(rx.prescription_number ILIKE $${params.length} OR ver.snapshot->'patient'->>'fullName' ILIKE $${params.length})`
    );
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await db.query(
    `SELECT
       rx.*,
       ver.snapshot,
       ver.authorized_at,
       ver.authorization_method,
       (
         SELECT MAX(inner_ver.version)
         FROM prescription_versions AS inner_ver
         WHERE inner_ver.prescription_id = rx.id AND inner_ver.authorized_at IS NOT NULL
       ) AS authorized_version
     FROM prescriptions AS rx
     JOIN prescription_versions AS ver
       ON ver.prescription_id = rx.id AND ver.version = rx.current_version
     ${where}
     ORDER BY rx.updated_at DESC
     LIMIT 200`,
    params
  );
  return result.rows.map((row) =>
    serialize(row, {
      authorizedVersion: row.authorized_version,
      authorizedAt: row.authorized_at,
      authorizationMethod: row.authorization_method,
      patient: row.snapshot?.patient,
      dentist: row.snapshot?.dentist,
    })
  );
}

function serializePatientView(row, items = []) {
  const authorized = row.workflow_status === WORKFLOW.AUTHORIZED && Boolean(row.authorized_at);
  const snapshot = row.snapshot || {};
  return {
    id: row.id,
    prescriptionNumber: row.prescription_number,
    issuedAt: row.authorized_at || row.created_at,
    dentistName: snapshot.dentist?.fullName || "Dentist",
    workflowStatus: row.workflow_status,
    emailStatus: row.email_status,
    workflowLabel: patientWorkflowLabel(row.workflow_status),
    emailLabel: patientEmailLabel(row.email_status),
    medications: authorized
      ? items.map((item) => ({
          medicationName: item.medication_name || item.medicationName,
          quantity: item.quantity,
          dosage: item.dosage,
          sig: item.sig,
        }))
      : [],
    canViewDocument: authorized,
  };
}

async function listForPatientUser(db, userId) {
  const ownerId = String(userId || "");
  if (!ownerId) return [];
  const result = await db.query(
    `SELECT
       rx.*,
       ver.snapshot,
       ver.authorized_at,
       ver.authorization_method,
       ver.id AS version_row_id
     FROM prescriptions AS rx
     JOIN prescription_versions AS ver
       ON ver.prescription_id = rx.id AND ver.version = rx.current_version
     LEFT JOIN clinic_patient_records AS rec
       ON rec.id = rx.clinical_record_id
     WHERE rx.workflow_status = ANY($2::text[])
       AND (
         rx.linked_user_id = $1
         OR rec.linked_user_id = $1
       )
     ORDER BY COALESCE(ver.authorized_at, rx.updated_at) DESC
     LIMIT 100`,
    [ownerId, [...PATIENT_VISIBLE]]
  );
  const versionIds = result.rows.filter((row) => row.authorized_at).map((row) => row.version_row_id);
  const itemsByVersion = new Map();
  if (versionIds.length) {
    const items = await db.query(
      `SELECT * FROM prescription_items
       WHERE version_id = ANY($1::uuid[])
       ORDER BY sort_order ASC`,
      [versionIds]
    );
    for (const item of items.rows) {
      const list = itemsByVersion.get(item.version_id) || [];
      list.push(item);
      itemsByVersion.set(item.version_id, list);
    }
  }
  return result.rows.map((row) =>
    serializePatientView(row, itemsByVersion.get(row.version_row_id) || [])
  );
}

async function assertPatientOwnsPrescription(db, userId, prescriptionId) {
  const ownerId = String(userId || "");
  const result = await db.query(
    `SELECT rx.id, rx.workflow_status, ver.authorized_at
     FROM prescriptions AS rx
     JOIN prescription_versions AS ver
       ON ver.prescription_id = rx.id AND ver.version = rx.current_version
     LEFT JOIN clinic_patient_records AS rec
       ON rec.id = rx.clinical_record_id
     WHERE rx.id = $1
       AND (
         rx.linked_user_id = $2
         OR rec.linked_user_id = $2
       )
     LIMIT 1`,
    [prescriptionId, ownerId]
  );
  const row = result.rows[0];
  if (!row || !PATIENT_VISIBLE.has(row.workflow_status)) {
    throw httpError(404, "That prescription was not found.");
  }
  return row;
}

async function createPrescription(db, { dentist, body }) {
  const clinicalRecordId = numericId(body?.clinicalRecordId || body?.patientId);
  if (!clinicalRecordId) throw httpError(400, "Select an existing patient record.");
  const items = normalizeItems(body?.items);
  const clinicalNotes = stringValue(body?.clinicalNotes, 2000);
  const appointmentId = numericId(body?.appointmentId);
  const treatmentId = numericId(body?.treatmentId);
  const patient = await loadPatientRecord(db, clinicalRecordId);
  const clinic = await loadClinic(db);
  let includeAftercare = Boolean(body?.includeExtractionAftercare);
  if (includeAftercare && !(await treatmentSupportsAftercare(db, treatmentId))) {
    throw httpError(
      400,
      "Extraction aftercare can be printed only when this prescription is linked to a confirmed extraction procedure. The clinic pad wording is used; medication is never suggested from the procedure."
    );
  }
  const client = await db.connect();
  const id = crypto.randomUUID();
  try {
    await client.query("BEGIN");
    const number = await nextPrescriptionNumber(client);
    await client.query(
      `INSERT INTO prescriptions (
         id, prescription_number, clinical_record_id, linked_user_id, appointment_id, treatment_id,
         current_version, workflow_status, email_status, include_extraction_aftercare, created_by_dentist_id
       ) VALUES ($1, $2, $3, $4, $5, $6, 1, 'draft', 'pending', $7, $8)`,
      [
        id,
        number,
        patient.id,
        patient.linkedUserId,
        appointmentId,
        treatmentId,
        includeAftercare,
        String(dentist.id),
      ]
    );
    await insertVersion(client, {
      prescriptionId: id,
      version: 1,
      items,
      clinicalNotes,
      includeExtractionAftercare: includeAftercare,
      patient,
      dentist,
      clinic,
      actorId: String(dentist.id),
      actorRole: "dentist",
    });
    await audit(client, {
      prescriptionId: id,
      version: 1,
      actorId: String(dentist.id),
      actorRole: "dentist",
      action: "created",
      detail: number,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return loadDetail(db, id);
}

async function updateDraft(db, { dentist, prescriptionId, body }) {
  const current = await loadDetail(db, prescriptionId);
  if (current.createdBy && false) {
    // placeholder to keep lint unused unused - created_by is on row
  }
  const owner = await db.query(`SELECT * FROM prescriptions WHERE id = $1`, [prescriptionId]);
  const row = owner.rows[0];
  if (!row) throw httpError(404, "That prescription was not found.");
  if (!CLINICAL_EDITABLE.has(row.workflow_status)) {
    throw httpError(409, "Only draft or returned prescriptions can be edited. Authorized clinical content is immutable.");
  }
  const items = normalizeItems(body?.items);
  const clinicalNotes = stringValue(body?.clinicalNotes, 2000);
  const includeAftercare = Boolean(body?.includeExtractionAftercare);
  const treatmentId = numericId(body?.treatmentId) || numericId(row.treatment_id);
  if (includeAftercare && !(await treatmentSupportsAftercare(db, treatmentId))) {
    throw httpError(
      400,
      "Extraction aftercare can be printed only when this prescription is linked to a confirmed extraction procedure. The clinic pad wording is used; medication is never suggested from the procedure."
    );
  }
  const patient = await loadPatientRecord(db, row.clinical_record_id);
  const clinic = await loadClinic(db);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const ver = await client.query(
      `SELECT id, content_hash, authorized_at FROM prescription_versions
       WHERE prescription_id = $1 AND version = $2 FOR UPDATE`,
      [prescriptionId, row.current_version]
    );
    const versionRow = ver.rows[0];
    const nextPayload = clinicalPayload(items, clinicalNotes, includeAftercare);
    const nextHash = contentHash(nextPayload);
    if (versionRow.authorized_at) {
      throw httpError(409, "This version is authorized and cannot be changed. Create a new version instead.");
    }
    if (treatmentId) {
      await client.query(`UPDATE prescriptions SET treatment_id = $1, include_extraction_aftercare = $2 WHERE id = $3`, [
        treatmentId,
        includeAftercare,
        prescriptionId,
      ]);
    } else {
      await client.query(`UPDATE prescriptions SET include_extraction_aftercare = $1 WHERE id = $2`, [
        includeAftercare,
        prescriptionId,
      ]);
    }
    if (row.workflow_status === WORKFLOW.RETURNED || versionRow.content_hash !== nextHash) {
      const nextVersion = row.current_version + (row.workflow_status === WORKFLOW.RETURNED ? 1 : 0);
      const replaceInPlace = row.workflow_status === WORKFLOW.DRAFT;
      if (replaceInPlace) {
        await client.query(`DELETE FROM prescription_versions WHERE id = $1`, [versionRow.id]);
        await insertVersion(client, {
          prescriptionId,
          version: row.current_version,
          items,
          clinicalNotes,
          includeExtractionAftercare: includeAftercare,
          patient,
          dentist,
          clinic,
          actorId: String(dentist.id),
          actorRole: "dentist",
        });
      } else {
        await insertVersion(client, {
          prescriptionId,
          version: nextVersion,
          items,
          clinicalNotes,
          includeExtractionAftercare: includeAftercare,
          patient,
          dentist,
          clinic,
          actorId: String(dentist.id),
          actorRole: "dentist",
        });
        await client.query(
          `UPDATE prescriptions
           SET current_version = $2, workflow_status = 'draft', return_reason = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [prescriptionId, nextVersion]
        );
      }
      await client.query(
        `UPDATE prescriptions
         SET include_extraction_aftercare = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [prescriptionId, includeAftercare]
      );
      await audit(client, {
        prescriptionId,
        version: replaceInPlace ? row.current_version : nextVersion,
        actorId: String(dentist.id),
        actorRole: "dentist",
        action: "revised",
      });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return loadDetail(db, prescriptionId);
}

async function submitToStaff(db, { dentist, prescriptionId }) {
  const result = await db.query(`SELECT * FROM prescriptions WHERE id = $1`, [prescriptionId]);
  const row = result.rows[0];
  if (!row) throw httpError(404, "That prescription was not found.");
  if (!CLINICAL_EDITABLE.has(row.workflow_status)) {
    throw httpError(409, "Only a draft or returned prescription can be sent to staff.");
  }
  const items = await db.query(
    `SELECT 1 FROM prescription_items AS item
     JOIN prescription_versions AS ver ON ver.id = item.version_id
     WHERE ver.prescription_id = $1 AND ver.version = $2
     LIMIT 1`,
    [prescriptionId, row.current_version]
  );
  if (!items.rows.length) throw httpError(400, "Add medication items before submitting to staff.");
  await db.query(
    `UPDATE prescriptions
     SET workflow_status = 'sent_to_staff', updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [prescriptionId]
  );
  await audit(db, {
    prescriptionId,
    version: row.current_version,
    actorId: String(dentist.id),
    actorRole: "dentist",
    action: "submitted_to_staff",
  });
  return loadDetail(db, prescriptionId);
}

async function authorize(db, { dentist, prescriptionId }) {
  const result = await db.query(`SELECT * FROM prescriptions WHERE id = $1`, [prescriptionId]);
  const row = result.rows[0];
  if (!row) throw httpError(404, "That prescription was not found.");
  if (row.workflow_status === WORKFLOW.CANCELLED) {
    throw httpError(409, "A cancelled prescription cannot be authorized.");
  }
  if (![WORKFLOW.DRAFT, WORKFLOW.SENT_TO_STAFF, WORKFLOW.PROCESSING, WORKFLOW.RETURNED].includes(row.workflow_status)) {
    if (row.workflow_status === WORKFLOW.AUTHORIZED) {
      throw httpError(409, "This prescription version is already authorized.");
    }
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const ver = await client.query(
      `SELECT * FROM prescription_versions
       WHERE prescription_id = $1 AND version = $2
       FOR UPDATE`,
      [prescriptionId, row.current_version]
    );
    const versionRow = ver.rows[0];
    if (versionRow.authorized_at) {
      throw httpError(409, "This version is already authorized.");
    }
    await client.query(
      `UPDATE prescription_versions
       SET authorized_at = CURRENT_TIMESTAMP,
           authorized_by = $2,
           authorization_method = 'authenticated_dentist_account'
       WHERE id = $1`,
      [versionRow.id, String(dentist.id)]
    );
    await client.query(
      `UPDATE prescriptions
       SET workflow_status = 'authorized', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [prescriptionId]
    );
    await audit(client, {
      prescriptionId,
      version: row.current_version,
      actorId: String(dentist.id),
      actorRole: "dentist",
      action: "authorized",
      detail: `hash:${versionRow.content_hash}`,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return loadDetail(db, prescriptionId);
}

async function cancelPrescription(db, { actorId, actorRole, prescriptionId }) {
  const result = await db.query(`SELECT * FROM prescriptions WHERE id = $1`, [prescriptionId]);
  const row = result.rows[0];
  if (!row) throw httpError(404, "That prescription was not found.");
  if (row.workflow_status === WORKFLOW.CANCELLED) {
    throw httpError(409, "This prescription is already cancelled.");
  }
  await db.query(
    `UPDATE prescriptions
     SET workflow_status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP,
         cancelled_by = $2, cancelled_by_role = $3, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [prescriptionId, actorId, actorRole]
  );
  await audit(db, {
    prescriptionId,
    version: row.current_version,
    actorId,
    actorRole,
    action: "cancelled",
  });
  return loadDetail(db, prescriptionId);
}

async function markProcessing(db, { staff, prescriptionId }) {
  const result = await db.query(`SELECT * FROM prescriptions WHERE id = $1`, [prescriptionId]);
  const row = result.rows[0];
  if (!row) throw httpError(404, "That prescription was not found.");
  if (![WORKFLOW.SENT_TO_STAFF, WORKFLOW.PROCESSING, WORKFLOW.AUTHORIZED].includes(row.workflow_status)) {
    throw httpError(409, "Staff can process only prescriptions submitted by a dentist.");
  }
  if (row.workflow_status === WORKFLOW.SENT_TO_STAFF) {
    await db.query(
      `UPDATE prescriptions SET workflow_status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [prescriptionId]
    );
  }
  await audit(db, {
    prescriptionId,
    version: row.current_version,
    actorId: String(staff.id),
    actorRole: "staff",
    action: "processing",
  });
  return loadDetail(db, prescriptionId);
}

async function returnToDentist(db, { staff, prescriptionId, reason }) {
  const detail = stringValue(reason, 1000);
  if (!detail) throw httpError(400, "Provide a reason so the dentist can correct the clinical content.");
  const result = await db.query(`SELECT * FROM prescriptions WHERE id = $1`, [prescriptionId]);
  const row = result.rows[0];
  if (!row) throw httpError(404, "That prescription was not found.");
  if (!STAFF_QUEUE.has(row.workflow_status) && row.workflow_status !== WORKFLOW.AUTHORIZED) {
    throw httpError(409, "This prescription cannot be returned in its current status.");
  }
  await db.query(
    `UPDATE prescriptions
     SET workflow_status = 'returned_to_dentist', return_reason = $2, email_status = 'pending',
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [prescriptionId, detail]
  );
  await audit(db, {
    prescriptionId,
    version: row.current_version,
    actorId: String(staff.id),
    actorRole: "staff",
    action: "returned_to_dentist",
    detail,
  });
  return loadDetail(db, prescriptionId);
}

async function authorizedVersionRow(db, prescriptionId) {
  const result = await db.query(
    `SELECT rx.*, ver.*
     FROM prescriptions AS rx
     JOIN prescription_versions AS ver
       ON ver.prescription_id = rx.id AND ver.version = rx.current_version
     WHERE rx.id = $1
     LIMIT 1`,
    [prescriptionId]
  );
  const row = result.rows[0];
  if (!row) throw httpError(404, "That prescription was not found.");
  if (row.workflow_status === WORKFLOW.CANCELLED) {
    throw httpError(409, "Cancelled prescriptions cannot be processed or emailed.");
  }
  if (row.workflow_status !== WORKFLOW.AUTHORIZED || !row.authorized_at) {
    throw httpError(409, "Staff may generate or send only the dentist-authorized current version.");
  }
  return row;
}

function ensureUploadDir(directory = DEFAULT_UPLOAD_DIR) {
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

async function generateOrRetrievePdf(db, { actorId, actorRole, prescriptionId, uploadDirectory = DEFAULT_UPLOAD_DIR }) {
  const row = await authorizedVersionRow(db, prescriptionId);
  const existing = await db.query(
    `SELECT * FROM prescription_pdfs WHERE version_id = $1 AND content_hash = $2 LIMIT 1`,
    [row.id, row.content_hash]
  );
  const directory = ensureUploadDir(uploadDirectory);
  if (existing.rows[0]) {
    const stored = path.join(directory, existing.rows[0].stored_name);
    if (fs.existsSync(stored)) {
      return {
        filePath: stored,
        meta: existing.rows[0],
        prescription: row,
        storedName: existing.rows[0].stored_name,
      };
    }
  }
  const items = await db.query(
    `SELECT * FROM prescription_items WHERE version_id = $1 ORDER BY sort_order ASC`,
    [row.id]
  );
  const storedName = `rx-${row.prescription_number.replace(/[^A-Za-z0-9-]/g, "")}-v${row.version}.pdf`;
  const filePath = path.join(directory, storedName);
  const buffer = await generatePrescriptionPdf({
    prescriptionNumber: row.prescription_number,
    version: row.version,
    contentHash: row.content_hash,
    authorizedAt: row.authorized_at,
    snapshot: row.snapshot,
    items: items.rows.map(mapItem),
    clinicalNotes: row.clinical_notes,
  });
  fs.writeFileSync(filePath, buffer);
  const pdfId = crypto.randomUUID();
  await db.query(
    `INSERT INTO prescription_pdfs (
       id, prescription_id, version_id, content_hash, stored_name, byte_size, generated_by, generated_by_role
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (version_id, content_hash) DO UPDATE SET stored_name = EXCLUDED.stored_name, byte_size = EXCLUDED.byte_size`,
    [pdfId, prescriptionId, row.id, row.content_hash, storedName, buffer.length, actorId, actorRole]
  );
  await audit(db, {
    prescriptionId,
    version: row.version,
    actorId,
    actorRole,
    action: "pdf_generated",
    detail: storedName,
  });
  return { filePath, buffer, prescription: row, storedName };
}

async function generateOrRetrieveJpeg(db, options) {
  const pdf = await generateOrRetrievePdf(db, options);
  const source = pdf.buffer || fs.readFileSync(pdf.filePath);
  const pages = await rasterizePrescriptionPdf(source);
  if (!pages.length) {
    throw httpError(501, "JPEG export is unavailable for this document. Download the PDF instead.");
  }
  await audit(db, {
    prescriptionId: options.prescriptionId,
    version: pdf.prescription.version,
    actorId: options.actorId,
    actorRole: options.actorRole,
    action: "jpeg_generated",
    detail: `${pages.length} page(s)`,
  });
  return { ...pdf, pages };
}

function sendConfirmation(detail) {
  const snapshot = detail.patient ? detail : {};
  void snapshot;
  return {
    prescriptionId: detail.id,
    prescriptionNumber: detail.prescriptionNumber,
    authorizedVersion: detail.currentVersion,
    patientName: detail.patient?.fullName || detail.patient?.fullName,
    recipientEmailMasked: detail.recipientEmailMasked,
    workflowStatus: detail.workflowStatus,
    contentHash: detail.contentHash,
  };
}

async function prepareSend(db, { staff, prescriptionId }) {
  void staff;
  const row = await authorizedVersionRow(db, prescriptionId);
  const detail = await loadDetail(db, prescriptionId);
  if (!detail.patient?.email && !row.snapshot?.patient?.email) {
    throw httpError(409, "This patient record has no registered email address.");
  }
  return {
    confirmation: {
      prescriptionId: detail.id,
      prescriptionNumber: detail.prescriptionNumber,
      authorizedVersion: detail.currentVersion,
      patientName: row.snapshot?.patient?.fullName,
      recipientEmailMasked: maskEmail(row.snapshot?.patient?.email),
      contentHash: row.content_hash,
    },
    recipientEmail: row.snapshot?.patient?.email,
  };
}

async function sendAuthorizedEmail(db, {
  staff,
  prescriptionId,
  confirmPrescriptionId,
  confirmVersion,
  confirmRecipientMasked,
  sendMail = sendMailMessage,
  env = process.env,
  uploadDirectory = DEFAULT_UPLOAD_DIR,
}) {
  const prepared = await prepareSend(db, { staff, prescriptionId });
  if (String(confirmPrescriptionId) !== String(prescriptionId)) {
    throw httpError(400, "Confirm the prescription identifier before sending.");
  }
  if (Number(confirmVersion) !== Number(prepared.confirmation.authorizedVersion)) {
    throw httpError(400, "Confirm the authorized version before sending.");
  }
  if (stringValue(confirmRecipientMasked) !== prepared.confirmation.recipientEmailMasked) {
    throw httpError(400, "Confirm the registered recipient email before sending.");
  }
  const intended = normalizeEmail(prepared.recipientEmail);
  if (!intended) throw httpError(409, "This patient record has no registered email address.");
  const override = stringValue(env.PRESCRIPTION_EMAIL_OVERRIDE, 160);
  const production = env.NODE_ENV === "production" || env.DENTASYNC_PRODUCTION === "true";
  const actual = !production && override ? normalizeEmail(override) : intended;
  if (!actual) throw httpError(400, "PRESCRIPTION_EMAIL_OVERRIDE is not a valid email address.");

  const { filePath, prescription } = await generateOrRetrievePdf(db, {
    actorId: String(staff.id),
    actorRole: "staff",
    prescriptionId,
    uploadDirectory,
  });
  const idempotencyKey = `rx:${prescriptionId}:v:${prescription.id}:send`;
  const attemptId = crypto.randomUUID();
  const client = await db.connect();
  let inserted = false;
  try {
    await client.query("BEGIN");
    const sent = await client.query(
      `SELECT id, status FROM prescription_email_attempts
       WHERE prescription_id = $1 AND version_id = $2 AND status = 'sent'
       LIMIT 1`,
      [prescriptionId, prescription.id]
    );
    if (sent.rows.length) {
      throw httpError(409, "This authorized version was already emailed. Retry is only for failed or unknown attempts.");
    }
    const inflight = await client.query(
      `SELECT id, status, attempted_at FROM prescription_email_attempts
       WHERE idempotency_key = $1
       LIMIT 1`,
      [idempotencyKey]
    );
    if (inflight.rows[0]?.status === "sending") {
      const age = Date.now() - new Date(inflight.rows[0].attempted_at).getTime();
      if (age < 120000) {
        throw httpError(409, "A send is already in progress for this authorized version.");
      }
    }
    if (inflight.rows[0]?.status === "sent") {
      throw httpError(409, "This authorized version was already emailed.");
    }
    await client.query(
      `INSERT INTO prescription_email_attempts (
         id, prescription_id, version_id, idempotency_key, intended_recipient, actual_recipient,
         staff_user_id, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'sending')
       ON CONFLICT (idempotency_key) DO UPDATE
         SET status = 'sending', attempted_at = CURRENT_TIMESTAMP, failure_detail = NULL
         WHERE prescription_email_attempts.status IN ('failed', 'unknown', 'sending')
       RETURNING id`,
      [attemptId, prescriptionId, prescription.id, idempotencyKey, intended, actual, String(staff.id)]
    );
    await client.query(
      `UPDATE prescriptions SET email_status = 'sending', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [prescriptionId]
    );
    await client.query("COMMIT");
    inserted = true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (!emailDeliveryIsConfigured(env) && sendMail === sendMailMessage) {
    await db.query(
      `UPDATE prescription_email_attempts
       SET status = 'failed', failure_detail = $2, completed_at = CURRENT_TIMESTAMP
       WHERE idempotency_key = $1`,
      [idempotencyKey, "Email delivery is not configured."]
    );
    await db.query(`UPDATE prescriptions SET email_status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [
      prescriptionId,
    ]);
    throw httpError(503, "Email delivery is not configured on the server.");
  }

  try {
    const pdfBytes = fs.readFileSync(filePath);
    const info = await sendMail({
      to: actual,
      subject: "Your Prescription from Amethyst Dental Clinic",
      html: `<div style="font-family:Arial,sans-serif;color:#2a2433;padding:20px">
        <p>Hello,</p>
        <p>Amethyst Dental Clinic has attached your authorized prescription as a PDF.</p>
        <p>Please follow the instructions on the attached document. Contact the clinic if you have questions about this message.</p>
        <p>Amethyst Dental Clinic</p>
      </div>`,
      attachments: [
        {
          filename: path.basename(filePath),
          content: pdfBytes,
          contentType: "application/pdf",
        },
      ],
    }, env);
    const messageId = info?.messageId || null;
    await db.query(
      `UPDATE prescription_email_attempts
       SET status = 'sent', provider_message_id = $2, provider_result = 'accepted',
           completed_at = CURRENT_TIMESTAMP
       WHERE idempotency_key = $1`,
      [idempotencyKey, messageId]
    );
    await db.query(`UPDATE prescriptions SET email_status = 'sent', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [
      prescriptionId,
    ]);
    await audit(db, {
      prescriptionId,
      version: prescription.version,
      actorId: String(staff.id),
      actorRole: "staff",
      action: "email_sent",
      detail: maskEmail(intended),
    });
    return loadDetail(db, prescriptionId);
  } catch (error) {
    const uncertain = /timeout|ECONNRESET|socket hang up|ETIMEDOUT/i.test(String(error.message || ""));
    const status = uncertain ? EMAIL_STATUS.UNKNOWN : EMAIL_STATUS.FAILED;
    await db.query(
      `UPDATE prescription_email_attempts
       SET status = $2, failure_detail = $3, provider_result = $4, completed_at = CURRENT_TIMESTAMP
       WHERE idempotency_key = $1`,
      [idempotencyKey, status, String(error.message || "send failed").slice(0, 500), uncertain ? "unknown" : "failed"]
    );
    await db.query(`UPDATE prescriptions SET email_status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [
      prescriptionId,
      status,
    ]);
    await audit(db, {
      prescriptionId,
      version: prescription.version,
      actorId: String(staff.id),
      actorRole: "staff",
      action: uncertain ? "email_unknown" : "email_failed",
    });
    if (uncertain) {
      throw httpError(
        502,
        "The email provider did not confirm the result. The attempt was recorded as unknown so it will not be treated as delivered."
      );
    }
    throw httpError(502, "The prescription email could not be sent.");
  } finally {
    void inserted;
  }
}

async function retrySend(db, options) {
  const row = await authorizedVersionRow(db, options.prescriptionId);
  const last = await db.query(
    `SELECT status FROM prescription_email_attempts
     WHERE prescription_id = $1 AND version_id = $2
     ORDER BY attempted_at DESC LIMIT 1`,
    [options.prescriptionId, row.id]
  );
  const status = last.rows[0]?.status;
  if (status === "sent") {
    throw httpError(409, "This authorized version was already emailed.");
  }
  if (status && !["failed", "unknown"].includes(status)) {
    throw httpError(409, "Retry is available only after a failed or unknown send.");
  }
  if (status === "unknown" || status === "failed") {
    await db.query(
      `UPDATE prescription_email_attempts
       SET idempotency_key = idempotency_key || ':retry:' || id::text
       WHERE prescription_id = $1 AND version_id = $2 AND status IN ('failed', 'unknown', 'sending')`,
      [options.prescriptionId, row.id]
    );
  }
  return sendAuthorizedEmail(db, options);
}

function withSchema(operation) {
  return (database, ...args) => withPrescriptionSchema(database, () => operation(database, ...args));
}

module.exports = {
  WORKFLOW,
  EMAIL_STATUS,
  DEFAULT_UPLOAD_DIR,
  normalizeItems,
  contentHash,
  clinicalPayload,
  maskEmail,
  listPrescriptions: withSchema(listPrescriptions),
  listForPatientUser: withSchema(listForPatientUser),
  assertPatientOwnsPrescription: withSchema(assertPatientOwnsPrescription),
  loadDetail: withSchema(loadDetail),
  createPrescription: withSchema(createPrescription),
  updateDraft: withSchema(updateDraft),
  submitToStaff: withSchema(submitToStaff),
  authorize: withSchema(authorize),
  cancelPrescription: withSchema(cancelPrescription),
  markProcessing: withSchema(markProcessing),
  returnToDentist: withSchema(returnToDentist),
  prepareSend: withSchema(prepareSend),
  generateOrRetrievePdf: withSchema(generateOrRetrievePdf),
  generateOrRetrieveJpeg: withSchema(generateOrRetrieveJpeg),
  sendAuthorizedEmail: withSchema(sendAuthorizedEmail),
  retrySend: withSchema(retrySend),
  sendConfirmation,
  httpError,
};
