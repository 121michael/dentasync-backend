"use strict";

function stringValue(value, maxLength = 500) {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function numericId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function parseQrPayload(raw) {
  const text = stringValue(raw, 2000);
  if (!text) return null;

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      return {
        appointmentId: numericId(parsed.appointmentId || parsed.appointment_id),
        patientId: stringValue(parsed.patientId || parsed.patient_id || parsed.userId || parsed.user_id, 120),
        rfidTag: stringValue(parsed.rfid || parsed.rfidTag || parsed.tag, 120),
        code: stringValue(parsed.code || parsed.token, 120),
      };
    }
  } catch {
    // Plain text QR / RFID codes fall through.
  }

  if (/^A-\d{3,}$/i.test(text)) {
    return { code: text.toUpperCase() };
  }
  if (/^\d+$/.test(text)) {
    const asNumber = numericId(text);
    return asNumber ? { appointmentId: asNumber, patientId: text, code: text } : { code: text };
  }
  return { code: text, rfidTag: text, patientId: text };
}

async function findPatient(client, { patientId, rfidTag, code, phone, email }) {
  const clauses = [];
  const params = [];

  if (patientId) {
    params.push(String(patientId));
    clauses.push(`id::text = $${params.length}`);
  }
  if (rfidTag) {
    params.push(String(rfidTag));
    clauses.push(`LOWER(COALESCE(rfid_tag, '')) = LOWER($${params.length})`);
  }
  if (code) {
    params.push(String(code));
    clauses.push(`id::text = $${params.length}`);
    params.push(String(code));
    clauses.push(`LOWER(COALESCE(rfid_tag, '')) = LOWER($${params.length})`);
  }
  if (phone) {
    const digits = String(phone).replace(/\D/g, "");
    if (digits) {
      params.push(digits);
      clauses.push(`regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = $${params.length}`);
    }
  }
  if (email) {
    params.push(String(email).toLowerCase());
    clauses.push(`LOWER(email) = $${params.length}`);
  }

  if (!clauses.length) {
    return null;
  }

  const result = await client.query(
    `SELECT id, first_name, last_name, email, phone, role, status, is_verified, rfid_tag
     FROM users
     WHERE LOWER(role) = 'patient'
       AND COALESCE(is_archived, FALSE) = FALSE
       AND (${clauses.join(" OR ")})
     ORDER BY id DESC
     LIMIT 1`,
    params
  );
  return result.rows[0] || null;
}

async function findAppointmentForCheckIn(client, { appointmentId, patientId }) {
  const clinicTz = process.env.CLINIC_TIMEZONE || "Asia/Manila";

  if (appointmentId) {
    const byId = await client.query(
      `SELECT appointment.*, CONCAT_WS(' ', patient.first_name, patient.last_name) AS patient_name,
              patient.phone AS patient_phone, patient.email AS patient_email
       FROM patient_portal_appointments AS appointment
       JOIN users AS patient ON patient.id::text = appointment.user_id::text
       WHERE appointment.id = $1
         AND LOWER(appointment.status) IN ('confirmed', 'checked_in', 'pending')
       LIMIT 1`,
      [appointmentId]
    );
    if (byId.rows[0]) return byId.rows[0];
  }

  if (!patientId) return null;

  const today = await client.query(
    `SELECT appointment.*, CONCAT_WS(' ', patient.first_name, patient.last_name) AS patient_name,
            patient.phone AS patient_phone, patient.email AS patient_email
     FROM patient_portal_appointments AS appointment
     JOIN users AS patient ON patient.id::text = appointment.user_id::text
     WHERE appointment.user_id::text = $1::text
       AND appointment.appointment_date = (CURRENT_TIMESTAMP AT TIME ZONE $2)::date
       AND LOWER(appointment.status) IN ('confirmed', 'checked_in', 'pending')
     ORDER BY
       CASE
         WHEN EXISTS (
           SELECT 1
           FROM patient_portal_queue_entries AS queue
           WHERE queue.appointment_id = appointment.id
             AND queue.status NOT IN ('completed', 'no_show')
         ) THEN 1
         ELSE 0
       END,
       CASE LOWER(appointment.status)
         WHEN 'confirmed' THEN 0
         WHEN 'pending' THEN 1
         ELSE 2
       END,
       appointment.appointment_time ASC
     LIMIT 1`,
    [String(patientId), clinicTz]
  );
  return today.rows[0] || null;
}

async function diagnoseMissingCheckInAppointment(client, patient) {
  const clinicTz = process.env.CLINIC_TIMEZONE || "Asia/Manila";
  const patientId = String(patient?.id || "");
  const fullName = `${patient?.first_name || ""} ${patient?.last_name || ""}`.trim();

  const todayResult = await client.query(
    `SELECT (CURRENT_TIMESTAMP AT TIME ZONE $1)::date::text AS clinic_today`,
    [clinicTz]
  );
  const clinicToday = todayResult.rows[0]?.clinic_today || null;

  const ownAppointments = await client.query(
    `SELECT id, service_name, dentist_name, appointment_date::text AS appointment_date,
            TO_CHAR(appointment_time, 'HH24:MI') AS appointment_time, status
     FROM patient_portal_appointments
     WHERE user_id::text = $1::text
     ORDER BY appointment_date DESC, appointment_time DESC
     LIMIT 5`,
    [patientId]
  );

  const sameNameToday = await client.query(
    `SELECT patient.id AS patient_id,
            CONCAT_WS(' ', patient.first_name, patient.last_name) AS full_name,
            appointment.id AS appointment_id,
            appointment.appointment_date::text AS appointment_date,
            appointment.status
     FROM patient_portal_appointments AS appointment
     JOIN users AS patient ON patient.id::text = appointment.user_id::text
     WHERE LOWER(CONCAT_WS(' ', patient.first_name, patient.last_name)) = LOWER($1)
       AND patient.id::text <> $2::text
       AND appointment.appointment_date = $3::date
       AND LOWER(appointment.status) IN ('confirmed', 'checked_in', 'pending')
     LIMIT 5`,
    [fullName || "__none__", patientId, clinicToday]
  );

  const hintParts = [];
  if (sameNameToday.rows.length) {
    const otherIds = sameNameToday.rows.map((row) => row.patient_id).join(", ");
    hintParts.push(
      `Another "${fullName}" account (id ${otherIds}) has today's appointment. Assign RFID to that patient id, or move the appointment.`
    );
  } else if (ownAppointments.rows.length) {
    const latest = ownAppointments.rows[0];
    hintParts.push(
      `This patient (id ${patientId}) has appointment on ${latest.appointment_date} status=${latest.status}, but clinic today is ${clinicToday}.`
    );
  } else {
    hintParts.push(
      `Patient id ${patientId} has no appointments. Create one for ${clinicToday} on this exact account.`
    );
  }

  return {
    clinicToday,
    clinicTimezone: clinicTz,
    recentAppointments: ownAppointments.rows,
    sameNamePatientsWithTodayAppointment: sameNameToday.rows,
    hint: hintParts.join(" "),
  };
}

function defaultWalkInDentist() {
  return {
    dentistId: "dr-sarah-cruz",
    dentistName: "Dr. Sarah Cruz",
  };
}

async function resolveWalkInDentist(client) {
  const catalogDentists = [
    { id: "dr-sarah-cruz", name: "Dr. Sarah Cruz" },
    { id: "dr-sarah-mitchell", name: "Dr. Sarah Mitchell" },
    { id: "dr-james-reyes", name: "Dr. James Reyes" },
    { id: "dr-ana-santos", name: "Dr. Ana Santos" },
  ];

  try {
    const linked = await withSavepoint(client, "resolve_walkin_dentist", async () =>
      client.query(
        `SELECT profile.catalog_dentist_id,
                CONCAT_WS(' ', account.first_name, account.last_name) AS full_name
         FROM admin_portal_dentist_profiles AS profile
         JOIN users AS account ON account.id = profile.user_id
         WHERE COALESCE(profile.catalog_dentist_id, '') <> ''
           AND COALESCE(account.is_archived, FALSE) = FALSE
           AND LOWER(COALESCE(account.status, 'active')) = 'active'
         ORDER BY account.id ASC
         LIMIT 1`
      )
    );
    if (linked.rows[0]?.catalog_dentist_id) {
      const catalogId = String(linked.rows[0].catalog_dentist_id).trim();
      if (catalogId) {
        const catalog = catalogDentists.find((item) => item.id === catalogId);
        const fullName = linked.rows[0].full_name || "";
        return {
          dentistId: catalogId,
          dentistName: catalog?.name || (fullName ? `Dr. ${fullName}` : "Clinic Dentist"),
        };
      }
    }
  } catch {
    // Fall through to catalog defaults when dentist profiles are unavailable.
  }

  return defaultWalkInDentist();
}

async function nextOpenWalkInSlot(client, dentistId, appointmentDate, preferredTime) {
  let candidate = preferredTime;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const conflict = await client.query(
      `SELECT id
       FROM patient_portal_appointments
       WHERE dentist_id = $1
         AND appointment_date = $2
         AND appointment_time = $3::time
         AND status NOT IN ('cancelled', 'no_show')
       LIMIT 1`,
      [dentistId, appointmentDate, candidate]
    );
    if (!conflict.rows.length) {
      return candidate;
    }
    const bumped = await client.query(
      `SELECT TO_CHAR(($1::time + ($2 || ' seconds')::interval), 'HH24:MI:SS') AS next_time`,
      [candidate, String(attempt + 1)]
    );
    candidate = bumped.rows[0]?.next_time || candidate;
  }
  return candidate;
}

async function ensureAppointmentLinkedToCatalogDentist(client, appointment) {
  if (!appointment) return appointment;
  const currentDentistId = String(appointment.dentist_id || "");
  if (currentDentistId && !currentDentistId.startsWith("walk-in-")) {
    return appointment;
  }
  const dentist = await resolveWalkInDentist(client);
  const fallback = defaultWalkInDentist();
  const catalogDentistId = dentist.dentistId || fallback.dentistId;
  const catalogDentistName = dentist.dentistName || fallback.dentistName;
  const slot = await nextOpenWalkInSlot(
    client,
    catalogDentistId,
    appointment.appointment_date,
    appointment.appointment_time || "09:00:00"
  );
  const updated = await client.query(
    `UPDATE patient_portal_appointments
     SET dentist_id = $1,
         dentist_name = $2,
         appointment_time = $3::time,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $4
     RETURNING *`,
    [catalogDentistId, catalogDentistName, slot, appointment.id]
  );
  const row = updated.rows[0] || appointment;
  row.patient_name = appointment.patient_name;
  row.patient_phone = appointment.patient_phone;
  row.patient_email = appointment.patient_email;
  return row;
}

async function createWalkInAppointmentForPatient(client, patient) {
  const clinicTz = process.env.CLINIC_TIMEZONE || "Asia/Manila";
  const clock = await client.query(
    `SELECT (CURRENT_TIMESTAMP AT TIME ZONE $1)::date AS clinic_today,
            TO_CHAR((CURRENT_TIMESTAMP AT TIME ZONE $1), 'HH24:MI:SS') AS clinic_time`,
    [clinicTz]
  );
  const appointmentDate = clock.rows[0].clinic_today;
  const preferredTime = clock.rows[0].clinic_time;
  const dentist = await resolveWalkInDentist(client);
  const fallback = defaultWalkInDentist();
  const dentistId = dentist.dentistId || fallback.dentistId;
  const dentistName = dentist.dentistName || fallback.dentistName;
  const appointmentTime = await nextOpenWalkInSlot(
    client,
    dentistId,
    appointmentDate,
    preferredTime
  );

  const inserted = await client.query(
    `INSERT INTO patient_portal_appointments (
       user_id, service_id, service_name, dentist_id, dentist_name,
       appointment_date, appointment_time, coverage_type, estimated_cost, notes, status
     ) VALUES (
       $1, 'general-consultation', 'Walk-in Consultation', $2, $3,
       $4, $5::time, 'self_pay', $6, $7, 'confirmed'
     )
     RETURNING *`,
    [
      String(patient.id),
      dentistId,
      dentistName,
      appointmentDate,
      appointmentTime,
      800,
      "Auto-created from RFID walk-in check-in.",
    ]
  );

  const appointment = inserted.rows[0];
  appointment.patient_name = `${patient.first_name || ""} ${patient.last_name || ""}`.trim();
  appointment.patient_phone = patient.phone || null;
  appointment.patient_email = patient.email || null;
  appointment._walkInCreated = true;
  return appointment;
}

async function resolveAppointmentForCheckIn(client, patient, { allowWalkIn = false } = {}) {
  let existing = await findAppointmentForCheckIn(client, { patientId: patient.id });
  if (existing) {
    existing = await ensureAppointmentLinkedToCatalogDentist(client, existing);
    return { appointment: existing, walkInCreated: false };
  }
  if (!allowWalkIn) {
    return { appointment: null, walkInCreated: false };
  }
  const appointment = await createWalkInAppointmentForPatient(client, patient);
  return { appointment, walkInCreated: true };
}

async function findAppointmentsForRfidLookup(client, patientId) {
  if (!patientId) return [];
  const clinicTz = process.env.CLINIC_TIMEZONE || "Asia/Manila";
  const result = await client.query(
    `SELECT appointment.*,
            CONCAT_WS(' ', patient.first_name, patient.last_name) AS patient_name,
            patient.phone AS patient_phone,
            patient.email AS patient_email
     FROM patient_portal_appointments AS appointment
     JOIN users AS patient ON patient.id::text = appointment.user_id::text
     WHERE appointment.user_id::text = $1::text
       AND LOWER(appointment.status) NOT IN ('cancelled', 'no_show')
     ORDER BY
       CASE
         WHEN appointment.appointment_date = (CURRENT_TIMESTAMP AT TIME ZONE $2)::date THEN 0
         WHEN appointment.appointment_date > (CURRENT_TIMESTAMP AT TIME ZONE $2)::date THEN 1
         ELSE 2
       END,
       CASE LOWER(appointment.status)
         WHEN 'confirmed' THEN 0
         WHEN 'pending' THEN 1
         WHEN 'checked_in' THEN 2
         ELSE 3
       END,
       appointment.appointment_date ASC,
       appointment.appointment_time ASC
     LIMIT 10`,
    [String(patientId), clinicTz]
  );
  return result.rows;
}

async function withSavepoint(client, name, fn) {
  const savepoint = String(name || "sp").replace(/[^a-zA-Z0-9_]/g, "_");
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    const result = await fn();
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (error) {
    try {
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    } catch (rollbackError) {
      error.savepointRollbackError = rollbackError.message;
    }
    throw error;
  }
}

async function findActiveQueueForPatient(client, patientId) {
  if (!patientId) return null;
  let result;
  try {
    result = await withSavepoint(client, "active_queue_with_method", async () =>
      client.query(
        `SELECT
           queue.id,
           queue.token,
           queue.position,
           queue.status,
           queue.estimated_wait_minutes,
           queue.checked_in_at,
           queue.appointment_id,
           queue.user_id,
           queue.check_in_method
         FROM patient_portal_queue_entries AS queue
         WHERE queue.user_id = $1
           AND DATE(queue.checked_in_at) = CURRENT_DATE
           AND queue.status NOT IN ('completed', 'no_show')
         ORDER BY queue.checked_in_at DESC
         LIMIT 1`,
        [String(patientId)]
      )
    );
  } catch (error) {
    if (error.code !== "42703") throw error;
    result = await client.query(
      `SELECT
         queue.id,
         queue.token,
         queue.position,
         queue.status,
         queue.estimated_wait_minutes,
         queue.checked_in_at,
         queue.appointment_id,
         queue.user_id
       FROM patient_portal_queue_entries AS queue
       WHERE queue.user_id = $1
         AND DATE(queue.checked_in_at) = CURRENT_DATE
         AND queue.status NOT IN ('completed', 'no_show')
       ORDER BY queue.checked_in_at DESC
       LIMIT 1`,
      [String(patientId)]
    );
  }
  return result.rows[0] || null;
}

async function allocateQueueToken(client, position) {
  const clinicTz = process.env.CLINIC_TIMEZONE || "Asia/Manila";
  const dayResult = await client.query(
    `SELECT TO_CHAR((CURRENT_TIMESTAMP AT TIME ZONE $1), 'YYMMDD') AS day_code`,
    [clinicTz]
  );
  const dayCode = dayResult.rows[0]?.day_code || "000000";
  const seq = String(Math.max(1, Number(position) || 1)).padStart(3, "0");
  const crypto = require("crypto");

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
    // Always include a random suffix — never reuse A-101 / A-YYMMDD-001 style tokens.
    const candidate = `A-${dayCode}-${seq}-${suffix}`;
    const clash = await client.query(
      `SELECT 1 FROM patient_portal_queue_entries WHERE token = $1 LIMIT 1`,
      [candidate]
    );
    if (!clash.rows.length) {
      return candidate;
    }
  }

  return `A-${dayCode}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

async function insertQueueEntry(client, { userId, appointmentId, token, position, estimatedWaitMinutes, method }) {
  try {
    return await withSavepoint(client, "queue_insert_with_method", async () =>
      client.query(
        `INSERT INTO patient_portal_queue_entries (
           user_id, appointment_id, token, position, status, estimated_wait_minutes, check_in_method
         ) VALUES ($1, $2, $3, $4, 'waiting', $5, $6)
         RETURNING id, token, position, status, estimated_wait_minutes, checked_in_at, check_in_method`,
        [String(userId), appointmentId, token, position, estimatedWaitMinutes, method]
      )
    );
  } catch (insertError) {
    if (insertError.code === "42703") {
      // Older databases without check_in_method still share the same queue table.
      return client.query(
        `INSERT INTO patient_portal_queue_entries (
           user_id, appointment_id, token, position, status, estimated_wait_minutes
         ) VALUES ($1, $2, $3, $4, 'waiting', $5)
         RETURNING id, token, position, status, estimated_wait_minutes, checked_in_at`,
        [String(userId), appointmentId, token, position, estimatedWaitMinutes]
      );
    }
    if (insertError.code === "23505") {
      const retryToken = await allocateQueueToken(client, position + Math.floor(Math.random() * 90) + 10);
      try {
        return await withSavepoint(client, "queue_insert_retry_method", async () =>
          client.query(
            `INSERT INTO patient_portal_queue_entries (
               user_id, appointment_id, token, position, status, estimated_wait_minutes, check_in_method
             ) VALUES ($1, $2, $3, $4, 'waiting', $5, $6)
             RETURNING id, token, position, status, estimated_wait_minutes, checked_in_at, check_in_method`,
            [String(userId), appointmentId, retryToken, position, estimatedWaitMinutes, method]
          )
        );
      } catch (retryError) {
        if (retryError.code !== "42703") throw retryError;
        return client.query(
          `INSERT INTO patient_portal_queue_entries (
             user_id, appointment_id, token, position, status, estimated_wait_minutes
           ) VALUES ($1, $2, $3, $4, 'waiting', $5)
           RETURNING id, token, position, status, estimated_wait_minutes, checked_in_at`,
          [String(userId), appointmentId, retryToken, position, estimatedWaitMinutes]
        );
      }
    }
    throw insertError;
  }
}

async function performStaffCheckIn(client, { appointment, staff, notifyClinicStaff, checkInMethod = "rfid" }) {
  const existingForPatient = await findActiveQueueForPatient(client, appointment.user_id);
  if (existingForPatient) {
    return {
      alreadyCheckedIn: true,
      queueEntry: existingForPatient,
      appointment,
    };
  }

  const positionResult = await client.query(
    `SELECT COALESCE(MAX(position), 0) + 1 AS next_position
     FROM patient_portal_queue_entries
     WHERE DATE(checked_in_at) = CURRENT_DATE`
  );
  const position = Number(positionResult.rows[0].next_position);
  const token = await allocateQueueToken(client, position);

  const aheadCount = Math.max(0, position - 1);
  // Keep wait estimates off optional tables while inside the check-in transaction.
  // Those lookups can abort Postgres mid-transaction when tables are missing.
  const estimatedWaitMinutes = aheadCount * 45;

  const method = String(checkInMethod || "rfid").toLowerCase();
  const queueResult = await insertQueueEntry(client, {
    userId: appointment.user_id,
    appointmentId: appointment.id,
    token,
    position,
    estimatedWaitMinutes,
    method,
  });

  await client.query(
    `UPDATE patient_portal_appointments
     SET status = 'checked_in', updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [appointment.id]
  );

  try {
    await withSavepoint(client, "queue_notify", async () => {
      await client.query(
        `INSERT INTO patient_portal_notifications (user_id, type, title, body)
         VALUES ($1, 'queue', $2, $3)`,
        [
          String(appointment.user_id),
          "Checked in successfully",
          `You are checked in. Queue number ${token}. Estimated wait about ${estimatedWaitMinutes} minutes.`,
        ]
      );
    });
  } catch (error) {
    // Missing notifications table (or optional columns) must not abort check-in.
    if (error.code !== "42P01" && error.code !== "42703") {
      throw error;
    }
  }

  if (typeof notifyClinicStaff === "function") {
    try {
      const patientName = appointment.patient_name || "Patient";
      const queueEntry = queueResult.rows[0];
      await notifyClinicStaff({
        type: "check_in",
        title: "Patient checked in",
        body: `${patientName} has checked in. Queue #${token}`,
        entityType: "queue",
        entityId: queueEntry.id,
        actorId: staff?.id,
      });
    } catch {
      // Non-blocking
    }
  }

  return {
    alreadyCheckedIn: false,
    queueEntry: queueResult.rows[0],
    appointment,
  };
}

module.exports = {
  parseQrPayload,
  findPatient,
  findAppointmentForCheckIn,
  diagnoseMissingCheckInAppointment,
  resolveAppointmentForCheckIn,
  createWalkInAppointmentForPatient,
  findAppointmentsForRfidLookup,
  findActiveQueueForPatient,
  performStaffCheckIn,
  stringValue,
  numericId,
};
