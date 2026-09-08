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
  if (appointmentId) {
    const byId = await client.query(
      `SELECT appointment.*, CONCAT_WS(' ', patient.first_name, patient.last_name) AS patient_name,
              patient.phone AS patient_phone, patient.email AS patient_email
       FROM patient_portal_appointments AS appointment
       JOIN users AS patient ON patient.id::text = appointment.user_id
       WHERE appointment.id = $1
         AND appointment.status IN ('confirmed', 'checked_in', 'pending')
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
     JOIN users AS patient ON patient.id::text = appointment.user_id
     WHERE appointment.user_id = $1
       AND appointment.appointment_date = CURRENT_DATE
       AND appointment.status IN ('confirmed', 'checked_in', 'pending')
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
       CASE appointment.status
         WHEN 'confirmed' THEN 0
         WHEN 'pending' THEN 1
         ELSE 2
       END,
       appointment.appointment_time ASC
     LIMIT 1`,
    [String(patientId)]
  );
  return today.rows[0] || null;
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
  findActiveQueueForPatient,
  performStaffCheckIn,
  stringValue,
  numericId,
};
