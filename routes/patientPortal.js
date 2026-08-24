"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const express = require("express");
const multer = require("multer");
const { linkClinicalRecordsToUser } = require("../services/clinicalPatients");

const SERVICES = [
  {
    id: "cleaning",
    name: "Dental Cleaning",
    description: "A gentle professional cleaning for a healthier, brighter smile.",
    duration: "45 min",
    estimatedCost: 1500,
  },
  {
    id: "extraction",
    name: "Tooth Extraction",
    description: "Comfort-focused removal with a personalized aftercare plan.",
    duration: "60 min",
    estimatedCost: 3500,
  },
  {
    id: "filling",
    name: "Dental Filling",
    description: "Natural-looking restoration for minor decay or damage.",
    duration: "45 min",
    estimatedCost: 2500,
  },
  {
    id: "root-canal",
    name: "Root Canal",
    description: "Specialist care to relieve pain and preserve your natural tooth.",
    duration: "90 min",
    estimatedCost: 12000,
  },
  {
    id: "orthodontic-consultation",
    name: "Orthodontic Consultation",
    description: "A tailored assessment for alignment and smile planning.",
    duration: "30 min",
    estimatedCost: 1000,
  },
  {
    id: "whitening",
    name: "Teeth Whitening",
    description: "Professional whitening for a luminous, confident smile.",
    duration: "60 min",
    estimatedCost: 8000,
  },
  {
    id: "general-consultation",
    name: "General Consultation",
    description: "A complete dental assessment with expert guidance.",
    duration: "30 min",
    estimatedCost: 800,
  },
  {
    id: "emergency-care",
    name: "Emergency Dental Care",
    description: "Priority assessment for urgent dental pain or injury.",
    duration: "45 min",
    estimatedCost: 2000,
  },
];

const DENTISTS = [
  {
    id: "dr-sarah-cruz",
    name: "Dr. Sarah Cruz",
    specialty: "Orthodontics and Dentofacial Orthopedics",
  },
  {
    id: "dr-sarah-mitchell",
    name: "Dr. Sarah Mitchell",
    specialty: "General & Cosmetic Dentistry",
  },
  {
    id: "dr-james-reyes",
    name: "Dr. James Reyes",
    specialty: "Endodontics & Restorative Care",
  },
  {
    id: "dr-ana-santos",
    name: "Dr. Ana Santos",
    specialty: "Orthodontics",
  },
];

const QUEUE_STEPS = [
  { id: "checked_in", label: "Checked In" },
  { id: "waiting", label: "Waiting" },
  { id: "preparing", label: "Preparing" },
  { id: "dentist", label: "Dentist" },
  { id: "completed", label: "Completed" },
];

const ALLOWED_UPLOAD_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

function requirePatient(req, res, next) {
  if ((req.user?.role || "").toLowerCase() !== "patient") {
    return res.status(403).json({ message: "This portal is available to patient accounts only." });
  }

  next();
}

function userIdFor(req) {
  return String(req.user.id);
}

function stringValue(value, maxLength = 500) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isTime(value) {
  return typeof value === "string" && /^\d{2}:\d{2}$/.test(value);
}

function isPastDate(value) {
  if (!isIsoDate(value)) {
    return true;
  }

  const today = new Date().toISOString().slice(0, 10);
  return value < today;
}

function resultCount(row, key) {
  return Number.parseInt(row?.[key] || "0", 10);
}

function queueSteps(status) {
  const currentIndex = Math.max(
    0,
    QUEUE_STEPS.findIndex((step) => step.id === status)
  );

  return QUEUE_STEPS.map((step, index) => ({
    ...step,
    state: index < currentIndex ? "complete" : index === currentIndex ? "current" : "upcoming",
  }));
}

function normalizeIsoDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    return text.slice(0, 10);
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function normalizeTime(value) {
  if (value == null) return null;
  const text = String(value).trim();
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function mapAppointment(appointment) {
  if (!appointment) {
    return null;
  }

  return {
    id: appointment.id,
    treatment: appointment.service_name,
    dentist: appointment.dentist_name,
    date: normalizeIsoDate(appointment.appointment_date),
    time: normalizeTime(appointment.appointment_time),
    location: appointment.clinic_location,
    coverage: appointment.coverage_type,
    hmoProvider: appointment.hmo_provider,
    estimatedCost: Number(appointment.estimated_cost),
    status: appointment.status,
    notes: appointment.notes,
  };
}

function createPatientPortalRouter({
  db,
  authenticateToken,
  uploadDirectory = path.join(process.cwd(), "uploads", "patient-portal"),
  notifyStaff = async () => {},
  notifyAdmin = async () => {},
  clinicSms = null,
}) {
  const router = express.Router();
  fs.mkdirSync(uploadDirectory, { recursive: true });

  async function notifyClinicStaff(notification) {
    try {
      await notifyStaff(notification);
    } catch (error) {
      // An operational patient action should not fail because the separate
      // staff notification feed is temporarily unavailable.
      console.warn("Unable to notify staff:", error.message);
    }
  }

  async function notifyClinicAdmins(notification) {
    try {
      await notifyAdmin(notification);
    } catch (error) {
      console.warn("Unable to notify admins:", error.message);
    }
  }

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, callback) => callback(null, uploadDirectory),
      filename: (_req, file, callback) => {
        const extension = path.extname(file.originalname).toLowerCase();
        callback(null, `${crypto.randomUUID()}${extension}`);
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, callback) => {
      if (!ALLOWED_UPLOAD_TYPES.has(file.mimetype)) {
        return callback(new Error("Only PDF, JPG, and PNG documents are accepted."));
      }
      callback(null, true);
    },
  });

  router.use(authenticateToken, requirePatient);

  router.get("/catalog", (_req, res) => {
    res.json({ services: SERVICES, dentists: DENTISTS });
  });

  router.get("/dashboard", async (req, res) => {
    const userId = userIdFor(req);

    try {
      const [
        userResult,
        appointmentResult,
        appointmentCountResult,
        queueResult,
        profileResult,
        notificationResult,
      ] = await Promise.all([
        db.query(
          `SELECT id, first_name, last_name, email, phone, is_verified
           FROM users
           WHERE id = $1`,
          [userId]
        ),
        db.query(
          `SELECT *
           FROM patient_portal_appointments
           WHERE user_id = $1
             AND appointment_date >= CURRENT_DATE
             AND status IN ('pending', 'confirmed', 'checked_in')
           ORDER BY appointment_date, appointment_time
           LIMIT 1`,
          [userId]
        ),
        db.query(
          `SELECT
             COUNT(*) FILTER (
               WHERE status IN ('pending', 'confirmed', 'checked_in')
             ) AS active_appointments,
             COUNT(*) FILTER (WHERE status = 'completed') AS completed_visits
           FROM patient_portal_appointments
           WHERE user_id = $1`,
          [userId]
        ),
        db.query(
          `SELECT token, position, status, estimated_wait_minutes
           FROM patient_portal_queue_entries
           WHERE user_id = $1
             AND status <> 'completed'
           ORDER BY checked_in_at DESC
           LIMIT 1`,
          [userId]
        ),
        db.query(
          `SELECT oral_health_score, last_cleaning, next_checkup,
                  hmo_provider, hmo_status, membership_tier
           FROM patient_portal_profiles
           WHERE user_id = $1`,
          [userId]
        ),
        db.query(
          `SELECT COUNT(*) FILTER (WHERE read_at IS NULL) AS unread_count
           FROM patient_portal_notifications
           WHERE user_id = $1`,
          [userId]
        ),
      ]);

      if (userResult.rows.length === 0) {
        return res.status(404).json({ message: "Patient account not found." });
      }

      const user = userResult.rows[0];
      const profile = profileResult.rows[0] || {};
      const queue = queueResult.rows[0] || null;
      const counts = appointmentCountResult.rows[0];

      return res.json({
        patient: {
          id: user.id,
          firstName: user.first_name,
          lastName: user.last_name,
          fullName: `${user.first_name || ""} ${user.last_name || ""}`.trim(),
          email: user.email,
          phone: user.phone,
          verified: user.is_verified,
          membershipTier: profile.membership_tier || "Premium Patient",
        },
        nextAppointment: mapAppointment(appointmentResult.rows[0]),
        metrics: {
          activeAppointments: resultCount(counts, "active_appointments"),
          completedVisits: resultCount(counts, "completed_visits"),
          queueToken: queue?.token || null,
          hmoStatus: profile.hmo_status || "not_enrolled",
        },
        wellness: {
          oralHealthScore: profile.oral_health_score ?? null,
          lastCleaning: profile.last_cleaning || null,
          nextCheckup: profile.next_checkup || null,
        },
        queue: queue
          ? {
              token: queue.token,
              position: queue.position,
              status: queue.status,
              estimatedWaitMinutes: queue.estimated_wait_minutes,
            }
          : null,
        unreadNotifications: resultCount(notificationResult.rows[0], "unread_count"),
      });
    } catch (error) {
      console.error("Patient dashboard error:", error.message);
      return res.status(500).json({ message: "Unable to load the patient dashboard." });
    }
  });

  router.get("/appointments", async (req, res) => {
    const userId = userIdFor(req);
    const status = stringValue(req.query.status, 32);
    const params = [userId];
    let statusClause = "";

    if (status && ["pending", "confirmed", "checked_in", "completed", "cancelled"].includes(status)) {
      params.push(status);
      statusClause = ` AND status = $${params.length}`;
    }

    try {
      const result = await db.query(
        `SELECT *
         FROM patient_portal_appointments
         WHERE user_id = $1${statusClause}
         ORDER BY appointment_date DESC, appointment_time DESC`,
        params
      );

      return res.json({ appointments: result.rows.map(mapAppointment) });
    } catch (error) {
      console.error("Patient appointments error:", error.message);
      return res.status(500).json({ message: "Unable to load appointments." });
    }
  });

  router.post("/appointments", async (req, res) => {
    const userId = userIdFor(req);
    const {
      serviceId,
      dentistId,
      appointmentDate,
      appointmentTime,
      coverageType,
      hmoProvider,
      hmoMemberNumber,
      authorizationDocumentId,
      notes,
    } = req.body || {};

    const service = SERVICES.find((item) => item.id === serviceId);
    const dentist = DENTISTS.find((item) => item.id === dentistId);
    const normalizedCoverage = coverageType === "hmo" ? "hmo" : coverageType === "self_pay" ? "self_pay" : null;

    if (!service || !dentist || !isIsoDate(appointmentDate) || !isTime(appointmentTime) || !normalizedCoverage) {
      return res.status(400).json({ message: "Please select a treatment, dentist, date, time, and coverage option." });
    }

    if (isPastDate(appointmentDate)) {
      return res.status(400).json({ message: "Appointments must be scheduled for a future date." });
    }

    const normalizedProvider = stringValue(hmoProvider, 120);
    const normalizedMemberNumber = stringValue(hmoMemberNumber, 120);
    if (normalizedCoverage === "hmo" && (!normalizedProvider || !normalizedMemberNumber)) {
      return res.status(400).json({ message: "HMO provider and member number are required for HMO coverage." });
    }

    try {
      if (authorizationDocumentId) {
        const documentResult = await db.query(
          `SELECT id
           FROM patient_portal_documents
           WHERE id = $1
             AND user_id = $2
             AND document_type = 'hmo_authorization'`,
          [authorizationDocumentId, userId]
        );
        if (documentResult.rows.length === 0) {
          return res.status(400).json({ message: "The HMO authorization document is not available." });
        }
      }

      const conflict = await db.query(
        `SELECT id
         FROM patient_portal_appointments
         WHERE dentist_id = $1
           AND appointment_date = $2
           AND appointment_time = $3
           AND status <> 'cancelled'
         LIMIT 1`,
        [dentist.id, appointmentDate, appointmentTime]
      );
      if (conflict.rows.length > 0) {
        return res.status(409).json({ message: "That time was just booked. Please choose another available slot." });
      }

      const result = await db.query(
        `INSERT INTO patient_portal_appointments (
           user_id, service_id, service_name, dentist_id, dentist_name,
           appointment_date, appointment_time, coverage_type, hmo_provider,
           hmo_member_number, authorization_document_id, estimated_cost, notes, status
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending'
         )
         RETURNING *`,
        [
          userId,
          service.id,
          service.name,
          dentist.id,
          dentist.name,
          appointmentDate,
          appointmentTime,
          normalizedCoverage,
          normalizedCoverage === "hmo" ? normalizedProvider : null,
          normalizedCoverage === "hmo" ? normalizedMemberNumber : null,
          authorizationDocumentId || null,
          service.estimatedCost,
          stringValue(notes, 1200),
        ]
      );

      await db.query(
        `INSERT INTO patient_portal_notifications (user_id, type, title, body)
         VALUES ($1, 'appointment', 'Appointment request received', $2)`,
        [
          userId,
          `${service.name} with ${dentist.name} on ${appointmentDate} at ${appointmentTime} is waiting for clinic confirmation.`,
        ]
      );
      await notifyClinicStaff({
        type: "appointment",
        title: "New Appointment Request",
        body: `A patient requested ${service.name} with ${dentist.name} on ${appointmentDate} at ${appointmentTime}.`,
        entityType: "appointment",
        entityId: result.rows[0].id,
      });
      await notifyClinicAdmins({
        type: "appointment",
        title: "New Appointment Request",
        body: `A patient requested ${service.name} with ${dentist.name} on ${appointmentDate} at ${appointmentTime}.`,
        entityType: "appointment",
        entityId: result.rows[0].id,
      });

      return res.status(201).json({
        message: "Your appointment request was submitted for clinic confirmation.",
        appointment: mapAppointment(result.rows[0]),
      });
    } catch (error) {
      if (error.code === "23505") {
        return res.status(409).json({ message: "That time was just booked. Please choose another available slot." });
      }
      console.error("Create appointment error:", error.message);
      return res.status(500).json({ message: "Unable to confirm the appointment." });
    }
  });

  router.patch("/appointments/:id/cancel", async (req, res) => {
    try {
      const result = await db.query(
        `UPDATE patient_portal_appointments
         SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
           AND user_id = $2
           AND status IN ('pending', 'confirmed')
         RETURNING *`,
        [req.params.id, userIdFor(req)]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ message: "A cancellable appointment was not found." });
      }

      await notifyClinicStaff({
        type: "appointment",
        title: "Appointment cancellation",
        body: `A patient cancelled ${result.rows[0].service_name} scheduled for ${result.rows[0].appointment_date} at ${String(result.rows[0].appointment_time).slice(0, 5)}.`,
        entityType: "appointment",
        entityId: result.rows[0].id,
      });
      return res.json({ appointment: mapAppointment(result.rows[0]) });
    } catch (error) {
      console.error("Cancel appointment error:", error.message);
      return res.status(500).json({ message: "Unable to cancel the appointment." });
    }
  });

  router.get("/queue", async (req, res) => {
    const userId = userIdFor(req);

    try {
      const [currentResult, liveResult, preferenceResult] = await Promise.all([
        db.query(
          `SELECT token, position, status, estimated_wait_minutes, checked_in_at
           FROM patient_portal_queue_entries
           WHERE user_id = $1
             AND status <> 'completed'
           ORDER BY checked_in_at DESC
           LIMIT 1`,
          [userId]
        ),
        db.query(
          `SELECT token, status, estimated_wait_minutes
           FROM patient_portal_queue_entries
           WHERE DATE(checked_in_at) = CURRENT_DATE
           ORDER BY position
           LIMIT 30`
        ),
        db.query(
          `SELECT notify_queue
           FROM patient_portal_preferences
           WHERE user_id = $1`,
          [userId]
        ),
      ]);

      const current = currentResult.rows[0] || null;
      const liveQueue = liveResult.rows;
      const nowServing = liveQueue.find((entry) => entry.status === "dentist") || null;

      return res.json({
        nowServing: nowServing?.token || null,
        current: current
          ? {
              token: current.token,
              position: current.position,
              status: current.status,
              estimatedWaitMinutes: current.estimated_wait_minutes,
              checkedInAt: current.checked_in_at,
              steps: queueSteps(current.status),
            }
          : null,
        queue: liveQueue.map((entry) => ({
          token: entry.token,
          status: entry.status,
          estimatedWaitMinutes: entry.estimated_wait_minutes,
          isCurrentPatient: entry.token === current?.token,
        })),
        notifyWhenNear: preferenceResult.rows[0]?.notify_queue || false,
      });
    } catch (error) {
      console.error("Patient queue error:", error.message);
      return res.status(500).json({ message: "Unable to load the live queue." });
    }
  });

  router.post("/queue/check-in", async (req, res) => {
    const userId = userIdFor(req);
    const appointmentId = Number.parseInt(req.body?.appointmentId, 10);
    if (!Number.isInteger(appointmentId)) {
      return res.status(400).json({ message: "A valid appointment is required for check-in." });
    }

    const client = await db.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      await client.query("SELECT pg_advisory_xact_lock(hashtext('patient_portal_queue'))");

      const appointmentResult = await client.query(
        `SELECT id
         FROM patient_portal_appointments
         WHERE id = $1 AND user_id = $2 AND status IN ('confirmed', 'checked_in')`,
        [appointmentId, userId]
      );
      if (appointmentResult.rows.length === 0) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return res.status(404).json({ message: "A confirmed appointment was not found." });
      }

      const existingResult = await client.query(
        `SELECT token, position, status, estimated_wait_minutes
         FROM patient_portal_queue_entries
         WHERE appointment_id = $1
           AND status <> 'completed'
         LIMIT 1`,
        [appointmentId]
      );
      if (existingResult.rows.length > 0) {
        await client.query("COMMIT");
        transactionOpen = false;
        return res.json({ queueEntry: existingResult.rows[0] });
      }

      const positionResult = await client.query(
        `SELECT COALESCE(MAX(position), 0) + 1 AS next_position
         FROM patient_portal_queue_entries
         WHERE DATE(checked_in_at) = CURRENT_DATE`
      );
      const position = Number(positionResult.rows[0].next_position);
      const token = `A-${String(position + 100).padStart(3, "0")}`;
      const estimatedWaitMinutes = Math.max(0, (position - 1) * 12);

      const queueResult = await client.query(
        `INSERT INTO patient_portal_queue_entries (
           user_id, appointment_id, token, position, status, estimated_wait_minutes
         ) VALUES ($1, $2, $3, $4, 'checked_in', $5)
         RETURNING token, position, status, estimated_wait_minutes`,
        [userId, appointmentId, token, position, estimatedWaitMinutes]
      );
      await client.query(
        `UPDATE patient_portal_appointments
         SET status = 'checked_in', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [appointmentId]
      );
      await client.query("COMMIT");
      transactionOpen = false;
      await notifyClinicStaff({
        type: "check_in",
        title: "Patient check-in alert",
        body: `A patient checked in and received queue token ${queueResult.rows[0].token}.`,
        entityType: "queue",
        entityId: queueResult.rows[0].token,
      });

      if (clinicSms?.notifyQueueSms) {
        clinicSms
          .notifyQueueSms({
            userId,
            queueEntry: queueResult.rows[0],
            actorRole: "patient",
            actorId: userId,
          })
          .catch((smsError) => console.warn("Patient check-in SMS failed:", smsError.message));
      }

      return res.status(201).json({ queueEntry: queueResult.rows[0] });
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK");
      }
      console.error("Queue check-in error:", error.message);
      return res.status(500).json({ message: "Unable to check in to the queue." });
    } finally {
      client.release();
    }
  });

  router.patch("/queue/notifications", async (req, res) => {
    const notifyWhenNear = Boolean(req.body?.notifyWhenNear);
    try {
      const result = await db.query(
        `INSERT INTO patient_portal_preferences (user_id, notify_queue)
         VALUES ($1, $2)
         ON CONFLICT (user_id)
         DO UPDATE SET notify_queue = EXCLUDED.notify_queue, updated_at = CURRENT_TIMESTAMP
         RETURNING notify_queue`,
        [userIdFor(req), notifyWhenNear]
      );
      return res.json({ notifyWhenNear: result.rows[0].notify_queue });
    } catch (error) {
      console.error("Queue preference error:", error.message);
      return res.status(500).json({ message: "Unable to update queue notification preferences." });
    }
  });

  router.get("/records", async (req, res) => {
    const userId = userIdFor(req);
    const params = [userId];
    const clauses = ["user_id = $1"];
    const search = stringValue(req.query.search, 100);
    const treatment = stringValue(req.query.treatment, 120);
    const from = stringValue(req.query.from, 10);
    const to = stringValue(req.query.to, 10);

    if (search) {
      params.push(`%${search}%`);
      clauses.push(`(treatment ILIKE $${params.length} OR dentist_name ILIKE $${params.length})`);
    }
    if (treatment) {
      params.push(treatment);
      clauses.push(`treatment = $${params.length}`);
    }
    if (isIsoDate(from)) {
      params.push(from);
      clauses.push(`treatment_date >= $${params.length}`);
    }
    if (isIsoDate(to)) {
      params.push(to);
      clauses.push(`treatment_date <= $${params.length}`);
    }

    try {
      // Attach any matching clinical charts created by dentist/staff.
      try {
        const profile = await db.query(
          `SELECT email, phone, first_name, last_name
           FROM users
           WHERE id::text = $1
           LIMIT 1`,
          [userId]
        );
        if (profile.rows[0]) {
          await linkClinicalRecordsToUser(db, {
            id: userId,
            email: profile.rows[0].email,
            phone: profile.rows[0].phone,
          });
        }
      } catch (linkError) {
        if (linkError?.code !== "42P01") {
          console.warn("Clinical record link skipped:", linkError.message);
        }
      }

      const [recordsResult, documentsResult, summaryResult, clinicalResult] = await Promise.all([
        db.query(
          `SELECT *
           FROM patient_portal_treatment_records
           WHERE ${clauses.join(" AND ")}
           ORDER BY treatment_date DESC, id DESC`,
          params
        ),
        db.query(
          `SELECT id, record_id, document_type, original_name, mime_type, byte_size, created_at
           FROM patient_portal_documents
           WHERE user_id = $1
           ORDER BY created_at DESC`,
          [userId]
        ),
        db.query(
          `SELECT
             COUNT(*) AS total_visits,
             COUNT(*) FILTER (WHERE status = 'completed') AS completed_treatments,
             COUNT(*) FILTER (WHERE status IN ('planned', 'in_progress')) AS active_treatment_plans
           FROM patient_portal_treatment_records
           WHERE user_id = $1`,
          [userId]
        ),
        db.query(
          `SELECT
             treatment.id,
             treatment.treatment,
             treatment.dentist_name,
             treatment.clinic_location,
             treatment.coverage_status,
             treatment.status,
             treatment.treatment_date,
             treatment.notes
           FROM clinic_patient_treatments AS treatment
           INNER JOIN clinic_patient_records AS record
             ON record.id = treatment.clinical_record_id
           WHERE record.linked_user_id = $1
             AND COALESCE(record.is_archived, FALSE) = FALSE
           ORDER BY treatment.treatment_date DESC, treatment.id DESC`,
          [userId]
        ).catch((error) => {
          if (error?.code === "42P01") {
            return { rows: [] };
          }
          throw error;
        }),
      ]);

      const documents = documentsResult.rows.map((document) => ({
        id: document.id,
        recordId: document.record_id,
        type: document.document_type,
        name: document.original_name,
        mimeType: document.mime_type,
        size: Number(document.byte_size),
        createdAt: document.created_at,
      }));
      const summary = summaryResult.rows[0];
      const portalRecords = recordsResult.rows.map((record) => ({
        id: record.id,
        date: record.treatment_date,
        treatment: record.treatment,
        dentist: record.dentist_name,
        clinic: record.clinic_location,
        coverage: record.coverage_status,
        status: record.status,
        notes: record.notes,
        source: "portal",
        documents: documents.filter((document) => String(document.recordId) === String(record.id)),
      }));
      const clinicalRecords = clinicalResult.rows.map((record) => ({
        id: `clinical-${record.id}`,
        date: record.treatment_date,
        treatment: record.treatment,
        dentist: record.dentist_name,
        clinic: record.clinic_location,
        coverage: record.coverage_status,
        status: record.status,
        notes: record.notes,
        source: "clinical",
        documents: [],
      }));

      const records = [...portalRecords, ...clinicalRecords].sort((left, right) => {
        const leftDate = String(left.date || "");
        const rightDate = String(right.date || "");
        return rightDate.localeCompare(leftDate);
      });

      const clinicalCompleted = clinicalRecords.filter((record) => record.status === "completed").length;
      const clinicalActive = clinicalRecords.filter((record) =>
        ["planned", "in_progress"].includes(String(record.status || ""))
      ).length;

      return res.json({
        summary: {
          totalVisits: resultCount(summary, "total_visits") + clinicalRecords.length,
          completedTreatments: resultCount(summary, "completed_treatments") + clinicalCompleted,
          xRaysAvailable: documents.filter((document) => document.type === "xray").length,
          activeTreatmentPlans: resultCount(summary, "active_treatment_plans") + clinicalActive,
        },
        records,
        documents: documents.filter((document) => !document.recordId),
      });
    } catch (error) {
      console.error("Treatment records error:", error.message);
      return res.status(500).json({ message: "Unable to load treatment records." });
    }
  });

  router.get("/records/:recordId/documents/:documentId/download", async (req, res) => {
    try {
      const result = await db.query(
        `SELECT original_name, stored_name
         FROM patient_portal_documents
         WHERE id = $1
           AND record_id = $2
           AND user_id = $3`,
        [req.params.documentId, req.params.recordId, userIdFor(req)]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ message: "Document not found." });
      }

      const document = result.rows[0];
      const filePath = path.resolve(uploadDirectory, document.stored_name);
      if (path.dirname(filePath) !== path.resolve(uploadDirectory) || !fs.existsSync(filePath)) {
        return res.status(404).json({ message: "Document file is unavailable." });
      }

      return res.download(filePath, document.original_name);
    } catch (error) {
      console.error("Document download error:", error.message);
      return res.status(500).json({ message: "Unable to download document." });
    }
  });

  router.get("/documents/:documentId/download", async (req, res) => {
    try {
      const result = await db.query(
        `SELECT original_name, stored_name
         FROM patient_portal_documents
         WHERE id = $1
           AND user_id = $2`,
        [req.params.documentId, userIdFor(req)]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ message: "Document not found." });
      }

      const document = result.rows[0];
      const filePath = path.resolve(uploadDirectory, document.stored_name);
      if (path.dirname(filePath) !== path.resolve(uploadDirectory) || !fs.existsSync(filePath)) {
        return res.status(404).json({ message: "Document file is unavailable." });
      }

      return res.download(filePath, document.original_name);
    } catch (error) {
      console.error("Patient document download error:", error.message);
      return res.status(500).json({ message: "Unable to download document." });
    }
  });

  router.post("/uploads/hmo-authorization", upload.single("file"), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ message: "Choose a PDF, JPG, or PNG authorization document." });
    }

    try {
      const documentId = crypto.randomUUID();
      await db.query(
        `INSERT INTO patient_portal_documents (
           id, user_id, document_type, original_name, stored_name, mime_type, byte_size
         ) VALUES ($1, $2, 'hmo_authorization', $3, $4, $5, $6)`,
        [
          documentId,
          userIdFor(req),
          req.file.originalname,
          req.file.filename,
          req.file.mimetype,
          req.file.size,
        ]
      );
      await notifyClinicStaff({
        type: "document",
        title: "Document submission alert",
        body: `A patient submitted ${req.file.originalname} for staff review.`,
        entityType: "document",
        entityId: documentId,
      });
      return res.status(201).json({
        document: {
          id: documentId,
          name: req.file.originalname,
          size: req.file.size,
        },
      });
    } catch (error) {
      fs.unlink(req.file.path, () => {});
      console.error("HMO upload error:", error.message);
      return res.status(500).json({ message: "Unable to save the authorization document." });
    }
  });

  router.get("/profile", async (req, res) => {
    const userId = userIdFor(req);
    try {
      const [userResult, profileResult, preferenceResult] = await Promise.all([
        db.query(
          `SELECT id, first_name, last_name, email, phone, is_verified, created_at
           FROM users
           WHERE id = $1`,
          [userId]
        ),
        db.query("SELECT * FROM patient_portal_profiles WHERE user_id = $1", [userId]),
        db.query("SELECT * FROM patient_portal_preferences WHERE user_id = $1", [userId]),
      ]);
      if (userResult.rows.length === 0) {
        return res.status(404).json({ message: "Patient account not found." });
      }

      const user = userResult.rows[0];
      return res.json({
        profile: {
          firstName: user.first_name || "",
          lastName: user.last_name || "",
          fullName: `${user.first_name || ""} ${user.last_name || ""}`.trim(),
          email: user.email || "",
          phone: user.phone || "",
          memberSince: user.created_at || null,
          verified: user.is_verified,
          ...(profileResult.rows[0] || {}),
        },
        preferences: {
          theme: preferenceResult.rows[0]?.theme || "light",
          notifyQueue: preferenceResult.rows[0]?.notify_queue || false,
          notifySms: preferenceResult.rows[0]?.notify_sms ?? true,
          notifyAppointmentSms: preferenceResult.rows[0]?.notify_appointment_sms ?? true,
          notifyQueueSms: preferenceResult.rows[0]?.notify_queue_sms ?? true,
          notifyCleaningSms: preferenceResult.rows[0]?.notify_cleaning_sms ?? true,
          twoFactorEnabled: preferenceResult.rows[0]?.two_factor_enabled || false,
        },
      });
    } catch (error) {
      console.error("Patient profile error:", error.message);
      return res.status(500).json({ message: "Unable to load your profile." });
    }
  });

  router.put("/profile", async (req, res) => {
    const userId = userIdFor(req);
    const body = req.body || {};
    const firstName = stringValue(body.firstName, 80);
    const lastName = stringValue(body.lastName, 80);
    const email = stringValue(body.email, 254)?.toLowerCase();
    const phone = stringValue(body.phone, 40);

    if (!firstName || !lastName || !email || !phone) {
      return res.status(400).json({ message: "Name, email address, and mobile number are required." });
    }

    try {
      await db.query(
        `UPDATE users
         SET first_name = $1, last_name = $2, email = $3, phone = $4
         WHERE id = $5`,
        [firstName, lastName, email, phone, userId]
      );
      const result = await db.query(
        `INSERT INTO patient_portal_profiles (
           user_id, date_of_birth, gender, address, emergency_contact_name,
           emergency_contact_relationship, emergency_contact_phone, allergies,
           existing_conditions, current_medications, dental_concerns, hmo_provider,
           hmo_member_number, hmo_status
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
           $14
         )
         ON CONFLICT (user_id) DO UPDATE SET
           date_of_birth = EXCLUDED.date_of_birth,
           gender = EXCLUDED.gender,
           address = EXCLUDED.address,
           emergency_contact_name = EXCLUDED.emergency_contact_name,
           emergency_contact_relationship = EXCLUDED.emergency_contact_relationship,
           emergency_contact_phone = EXCLUDED.emergency_contact_phone,
           allergies = EXCLUDED.allergies,
           existing_conditions = EXCLUDED.existing_conditions,
           current_medications = EXCLUDED.current_medications,
           dental_concerns = EXCLUDED.dental_concerns,
           hmo_provider = EXCLUDED.hmo_provider,
           hmo_member_number = EXCLUDED.hmo_member_number,
           hmo_status = EXCLUDED.hmo_status,
           updated_at = CURRENT_TIMESTAMP
         RETURNING *`,
        [
          userId,
          isIsoDate(body.dateOfBirth) ? body.dateOfBirth : null,
          stringValue(body.gender, 40),
          stringValue(body.address, 500),
          stringValue(body.emergencyContactName, 120),
          stringValue(body.emergencyContactRelationship, 80),
          stringValue(body.emergencyContactPhone, 40),
          stringValue(body.allergies, 1200),
          stringValue(body.existingConditions, 1200),
          stringValue(body.currentMedications, 1200),
          stringValue(body.dentalConcerns, 1200),
          stringValue(body.hmoProvider, 120),
          stringValue(body.hmoMemberNumber, 120),
          body.hmoProvider ? "pending_verification" : "not_enrolled",
        ]
      );

      return res.json({ message: "Your profile has been saved.", profile: result.rows[0] });
    } catch (error) {
      if (error.code === "23505") {
        return res.status(409).json({ message: "That email address or mobile number is already in use." });
      }
      console.error("Update patient profile error:", error.message);
      return res.status(500).json({ message: "Unable to save your profile." });
    }
  });

  router.put("/preferences", async (req, res) => {
    const theme = req.body?.theme === "dark" ? "dark" : "light";
    const notifyQueue = Boolean(req.body?.notifyQueue);
    const notifySms = req.body?.notifySms === undefined ? true : Boolean(req.body.notifySms);
    const notifyAppointmentSms =
      req.body?.notifyAppointmentSms === undefined ? true : Boolean(req.body.notifyAppointmentSms);
    const notifyQueueSms =
      req.body?.notifyQueueSms === undefined ? true : Boolean(req.body.notifyQueueSms);
    const notifyCleaningSms =
      req.body?.notifyCleaningSms === undefined ? true : Boolean(req.body.notifyCleaningSms);
    const twoFactorEnabled = Boolean(req.body?.twoFactorEnabled);

    try {
      const result = await db.query(
        `INSERT INTO patient_portal_preferences (
           user_id, theme, notify_queue, two_factor_enabled,
           notify_sms, notify_appointment_sms, notify_queue_sms, notify_cleaning_sms
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (user_id) DO UPDATE SET
           theme = EXCLUDED.theme,
           notify_queue = EXCLUDED.notify_queue,
           two_factor_enabled = EXCLUDED.two_factor_enabled,
           notify_sms = EXCLUDED.notify_sms,
           notify_appointment_sms = EXCLUDED.notify_appointment_sms,
           notify_queue_sms = EXCLUDED.notify_queue_sms,
           notify_cleaning_sms = EXCLUDED.notify_cleaning_sms,
           updated_at = CURRENT_TIMESTAMP
         RETURNING theme, notify_queue, two_factor_enabled,
                   notify_sms, notify_appointment_sms, notify_queue_sms, notify_cleaning_sms`,
        [
          userIdFor(req),
          theme,
          notifyQueue,
          twoFactorEnabled,
          notifySms,
          notifyAppointmentSms,
          notifyQueueSms,
          notifyCleaningSms,
        ]
      );
      const preference = result.rows[0];
      return res.json({
        preferences: {
          theme: preference.theme,
          notifyQueue: preference.notify_queue,
          notifySms: preference.notify_sms,
          notifyAppointmentSms: preference.notify_appointment_sms,
          notifyQueueSms: preference.notify_queue_sms,
          notifyCleaningSms: preference.notify_cleaning_sms,
          twoFactorEnabled: preference.two_factor_enabled,
        },
      });
    } catch (error) {
      if (error?.code === "42703") {
        // Migration not applied yet — keep legacy preference write working.
        try {
          const fallback = await db.query(
            `INSERT INTO patient_portal_preferences (
               user_id, theme, notify_queue, two_factor_enabled
             ) VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id) DO UPDATE SET
               theme = EXCLUDED.theme,
               notify_queue = EXCLUDED.notify_queue,
               two_factor_enabled = EXCLUDED.two_factor_enabled,
               updated_at = CURRENT_TIMESTAMP
             RETURNING theme, notify_queue, two_factor_enabled`,
            [userIdFor(req), theme, notifyQueue, twoFactorEnabled]
          );
          const preference = fallback.rows[0];
          return res.json({
            preferences: {
              theme: preference.theme,
              notifyQueue: preference.notify_queue,
              twoFactorEnabled: preference.two_factor_enabled,
            },
            message: "SMS preference columns are missing. Run npm run migrate:patient-sms.",
          });
        } catch (fallbackError) {
          console.error("Patient preferences fallback error:", fallbackError.message);
        }
      }
      console.error("Patient preferences error:", error.message);
      return res.status(500).json({ message: "Unable to update portal preferences." });
    }
  });

  router.get("/security", async (req, res) => {
    const userId = userIdFor(req);
    try {
      const [activityResult, preferenceResult, userResult] = await Promise.all([
        db.query(
          `SELECT event_type, ip_address, user_agent, created_at
           FROM patient_portal_login_activity
           WHERE user_id = $1
           ORDER BY created_at DESC
           LIMIT 8`,
          [userId]
        ),
        db.query(
          "SELECT two_factor_enabled FROM patient_portal_preferences WHERE user_id = $1",
          [userId]
        ),
        db.query("SELECT is_verified FROM users WHERE id = $1", [userId]),
      ]);
      return res.json({
        twoFactorEnabled: preferenceResult.rows[0]?.two_factor_enabled || false,
        verified: userResult.rows[0]?.is_verified || false,
        activity: activityResult.rows,
      });
    } catch (error) {
      console.error("Patient security error:", error.message);
      return res.status(500).json({ message: "Unable to load security settings." });
    }
  });

  router.put("/security/password", async (req, res) => {
    const currentPassword = req.body?.currentPassword;
    const newPassword = req.body?.newPassword;
    if (typeof currentPassword !== "string" || typeof newPassword !== "string" || newPassword.length < 10) {
      return res.status(400).json({ message: "Provide your current password and a new password of at least 10 characters." });
    }

    try {
      const userResult = await db.query(
        "SELECT password_hash FROM users WHERE id = $1",
        [userIdFor(req)]
      );
      if (userResult.rows.length === 0 || !(await bcrypt.compare(currentPassword, userResult.rows[0].password_hash))) {
        return res.status(400).json({ message: "Your current password is incorrect." });
      }

      const passwordHash = await bcrypt.hash(newPassword, 12);
      await db.query(
        "UPDATE users SET password_hash = $1 WHERE id = $2",
        [passwordHash, userIdFor(req)]
      );
      return res.json({ message: "Your password has been updated." });
    } catch (error) {
      console.error("Password update error:", error.message);
      return res.status(500).json({ message: "Unable to update your password." });
    }
  });

  router.get("/notifications", async (req, res) => {
    try {
      const result = await db.query(
        `SELECT id, type, title, body, read_at, created_at
         FROM patient_portal_notifications
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [userIdFor(req)]
      );
      return res.json({
        notifications: result.rows.map((notification) => ({
          id: notification.id,
          type: notification.type,
          title: notification.title,
          body: notification.body,
          read: Boolean(notification.read_at),
          createdAt: notification.created_at,
        })),
      });
    } catch (error) {
      console.error("Patient notifications error:", error.message);
      return res.status(500).json({ message: "Unable to load notifications." });
    }
  });

  router.patch("/notifications/:id/read", async (req, res) => {
    try {
      const result = await db.query(
        `UPDATE patient_portal_notifications
         SET read_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND user_id = $2
         RETURNING id`,
        [req.params.id, userIdFor(req)]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ message: "Notification not found." });
      }
      return res.json({ message: "Notification marked as read." });
    } catch (error) {
      console.error("Mark notification read error:", error.message);
      return res.status(500).json({ message: "Unable to update the notification." });
    }
  });

  router.use((error, _req, res, next) => {
    if (!error) {
      return next();
    }
    if (error instanceof multer.MulterError || error.message?.includes("Only PDF")) {
      return res.status(400).json({ message: error.message || "The uploaded document is not valid." });
    }
    return next(error);
  });

  return router;
}

module.exports = {
  DENTISTS,
  SERVICES,
  createPatientPortalRouter,
};
