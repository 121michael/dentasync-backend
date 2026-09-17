"use strict";

const { estimateWaitMinutesForPosition } = require("./waitTime");

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

async function createWalkInAppointmentForPatient(client, patient) {
  const clinicTz = process.env.CLINIC_TIMEZONE || "Asia/Manila";
  const clock = await client.query(
    `SELECT (CURRENT_TIMESTAMP AT TIME ZONE $1)::date AS clinic_today,
            TO_CHAR((CURRENT_TIMESTAMP AT TIME ZONE $1), 'HH24:MI:SS') AS clinic_time`,
    [clinicTz]
  );
  const appointmentDate = clock.rows[0].clinic_today;
  const appointmentTime = clock.rows[0].clinic_time;

  let dentistId = "walk-in-desk";
  let dentistName = "Clinic Walk-in";
  try {
    const dentist = await client.query(
      `SELECT id, CONCAT_WS(' ', first_name, last_name) AS full_name
       FROM users
       WHERE LOWER(role) = 'dentist'
         AND COALESCE(is_archived, FALSE) = FALSE
         AND LOWER(COALESCE(status, 'active')) = 'active'
       ORDER BY id ASC
       LIMIT 1`
    );
    if (dentist.rows[0]) {
      dentistId = String(dentist.rows[0].id);
      dentistName = dentist.rows[0].full_name || dentistName;
    }
  } catch {
    // Catalog fallback is fine when dentist users are unavailable.
  }

  const inserted = await client.query(
    `INSERT INTO patient_portal_appointments (
       user_id, service_id, service_name, dentist_id, dentist_name,
       appointment_date, appointment_time, coverage_type, notes, status
     ) VALUES (
       $1, 'general-consultation', 'Walk-in Consultation', $2, $3,
       $4, $5::time, 'self_pay', $6, 'confirmed'
     )
     RETURNING *`,
    [
      String(patient.id),
      dentistId,
      dentistName,
      appointmentDate,
      appointmentTime,
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
  const existing = await findAppointmentForCheckIn(client, { patientId: patient.id });
  if (existing) {
    return { appointment: existing, walkInCreated: false };
  }
  if (!allowWalkIn) {
    return { appointment: null, walkInCreated: false };
  }
  const appointment = await createWalkInAppointmentForPatient(client, patient);
  return { appointment, walkInCreated: true };
}

async function findActiveQueueForPatient(client, patientId) {
  if (!patientId) return null;
  const result = await client.query(
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
  ).catch(async (error) => {
    if (error.code !== "42703") throw error;
    return client.query(
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
  });
  return result.rows[0] || null;
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
  const token = `A-${String(position + 100).padStart(3, "0")}`;

  const aheadResult = await client.query(
    `SELECT appointment.service_id, appointment.service_name
     FROM patient_portal_queue_entries AS queue
     LEFT JOIN patient_portal_appointments AS appointment
       ON appointment.id = queue.appointment_id
     WHERE DATE(queue.checked_in_at) = CURRENT_DATE
       AND queue.status NOT IN ('completed', 'no_show')
       AND queue.position < $1
     ORDER BY queue.position ASC`,
    [position]
  );
  const estimatedWaitMinutes = await estimateWaitMinutesForPosition(client, {
    position,
    aheadEntries: aheadResult.rows,
  });

  const method = String(checkInMethod || "rfid").toLowerCase();
  let queueResult;
  try {
    queueResult = await client.query(
      `INSERT INTO patient_portal_queue_entries (
         user_id, appointment_id, token, position, status, estimated_wait_minutes, check_in_method
       ) VALUES ($1, $2, $3, $4, 'waiting', $5, $6)
       RETURNING id, token, position, status, estimated_wait_minutes, checked_in_at, check_in_method`,
      [String(appointment.user_id), appointment.id, token, position, estimatedWaitMinutes, method]
    );
  } catch (insertError) {
    if (insertError.code === "42703") {
      // Older databases without check_in_method still share the same queue table.
      queueResult = await client.query(
        `INSERT INTO patient_portal_queue_entries (
           user_id, appointment_id, token, position, status, estimated_wait_minutes
         ) VALUES ($1, $2, $3, $4, 'waiting', $5)
         RETURNING id, token, position, status, estimated_wait_minutes, checked_in_at`,
        [String(appointment.user_id), appointment.id, token, position, estimatedWaitMinutes]
      );
    } else {
      throw insertError;
    }
  }

  await client.query(
    `UPDATE patient_portal_appointments
     SET status = 'checked_in', updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [appointment.id]
  );

  try {
    await client.query(
      `INSERT INTO patient_portal_notifications (user_id, type, title, body)
       VALUES ($1, 'queue', $2, $3)`,
      [
        String(appointment.user_id),
        "Checked in successfully",
        `You are checked in. Queue number ${token}. Estimated wait about ${estimatedWaitMinutes} minutes.`,
      ]
    );
  } catch (error) {
    if (error.code !== "42P01") throw error;
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
  findActiveQueueForPatient,
  performStaffCheckIn,
  stringValue,
  numericId,
};
