"use strict";

const clinicSchedule = require("./clinicSchedule");
const clinicBranches = require("./clinicBranches");
const hmoVerification = require("./hmoVerification");
const { ACTIVE_QUEUE_STATUS_SQL } = require("./queueStatuses");

function clinicTimezone() {
  const raw = process.env.CLINIC_TIMEZONE || "Asia/Manila";
  return /^[A-Za-z0-9_+\-/]+$/.test(raw) ? raw : "Asia/Manila";
}

function clinicDateSql() {
  const tz = clinicTimezone().replace(/'/g, "''");
  return `(CURRENT_TIMESTAMP AT TIME ZONE '${tz}')::date`;
}

function clinicQueueTodaySql(alias = "queue") {
  const tz = clinicTimezone().replace(/'/g, "''");
  return `(${alias}.checked_in_at AT TIME ZONE '${tz}')::date = ${clinicDateSql()}`;
}

function activeQueueTodaySql(alias = "queue") {
  return `${clinicQueueTodaySql(alias)} AND ${alias}.status IN ${ACTIVE_QUEUE_STATUS_SQL}`;
}

function count(row, key = "count") {
  return Number.parseInt(row?.[key] || "0", 10);
}

function queueStatusSql(alias, key) {
  if (key === "checked_in") return `${alias}.status = 'checked_in'`;
  if (key === "waiting") return `${alias}.status = 'waiting'`;
  if (key === "in_treatment") return `${alias}.status IN ('preparing', 'dentist')`;
  if (key === "completed") return `${alias}.status = 'completed'`;
  if (key === "no_show") return `${alias}.status IN ('no_show', 'skipped')`;
  if (key === "cancelled") return `${alias}.status = 'cancelled'`;
  if (key === "not_served") return `${alias}.status = 'not_served'`;
  if (key === "needs_review") return `${alias}.status = 'needs_review'`;
  return null;
}

function appointmentTodaySql(alias = "appointment") {
  return `${alias}.appointment_date = ${clinicDateSql()}`;
}

function scopeParts({ branchId = null, dentistScope = null, appointmentAlias = "appointment" } = {}) {
  const clauses = [];
  const params = [];
  if (dentistScope?.sql) {
    clauses.push(dentistScope.sql);
    params.push(...(dentistScope.params || []));
  } else if (branchId) {
    params.push(branchId);
    clauses.push(`${appointmentAlias}.branch_id = $${params.length}`);
  }
  return {
    sql: clauses.length ? clauses.join(" AND ") : "TRUE",
    params,
  };
}

function queueScopeParts({ branchId = null, dentistScope = null } = {}) {
  const clauses = [`${clinicQueueTodaySql("queue")}`];
  const params = [];
  if (dentistScope?.sql) {
    clauses.push(dentistScope.sql);
    params.push(...(dentistScope.params || []));
  } else if (branchId) {
    params.push(branchId);
    clauses.push(`queue.branch_id = $${params.length}`);
  }
  return {
    sql: clauses.join(" AND "),
    params,
  };
}

function formatClock(value) {
  if (!value) return null;
  const text = String(value);
  const match = text.match(/(\d{2}:\d{2})/);
  return match ? match[1] : null;
}

async function loadFloorMetrics(db, options = {}) {
  const appointmentScope = scopeParts({ ...options, appointmentAlias: "appointment" });
  const queueScope = queueScopeParts(options);
  const queueJoin = options.dentistScope
    ? `JOIN patient_portal_appointments AS appointment ON appointment.id = queue.appointment_id`
    : "";

  const [
    bookedToday,
    checkedIn,
    waiting,
    inTreatment,
    completedToday,
    noShowToday,
    pendingRequests,
    pendingHmo,
    queueCompleted,
    queueNoShow,
  ] = await Promise.all([
    db.query(
      `SELECT COUNT(*) AS count
       FROM patient_portal_appointments AS appointment
       WHERE ${appointmentScope.sql}
         AND ${appointmentTodaySql("appointment")}
         AND appointment.status NOT IN ('cancelled', 'no_show')`,
      appointmentScope.params
    ),
    db.query(
      `SELECT COUNT(*) AS count
       FROM patient_portal_queue_entries AS queue
       ${queueJoin}
       WHERE ${queueScope.sql}
         AND ${queueStatusSql("queue", "checked_in")}`,
      queueScope.params
    ),
    db.query(
      `SELECT COUNT(*) AS count
       FROM patient_portal_queue_entries AS queue
       ${queueJoin}
       WHERE ${queueScope.sql}
         AND ${queueStatusSql("queue", "waiting")}`,
      queueScope.params
    ),
    db.query(
      `SELECT COUNT(*) AS count
       FROM patient_portal_queue_entries AS queue
       ${queueJoin}
       WHERE ${queueScope.sql}
         AND ${queueStatusSql("queue", "in_treatment")}`,
      queueScope.params
    ),
    db.query(
      `SELECT COUNT(*) AS count
       FROM patient_portal_appointments AS appointment
       WHERE ${appointmentScope.sql}
         AND ${appointmentTodaySql("appointment")}
         AND appointment.status = 'completed'`,
      appointmentScope.params
    ),
    db.query(
      `SELECT COUNT(*) AS count
       FROM patient_portal_appointments AS appointment
       WHERE ${appointmentScope.sql}
         AND ${appointmentTodaySql("appointment")}
         AND appointment.status = 'no_show'`,
      appointmentScope.params
    ),
    db.query(
      `SELECT COUNT(*) AS count
       FROM patient_portal_appointments AS appointment
       WHERE ${appointmentScope.sql}
         AND appointment.status = 'pending'`,
      appointmentScope.params
    ),
    options.dentistScope
      ? db.query(
          `SELECT COUNT(*) AS count
           FROM patient_portal_appointments AS appointment
           WHERE ${appointmentScope.sql}
             AND LOWER(COALESCE(appointment.coverage_type, '')) = 'hmo'
             AND appointment.hmo_verification_status = 'pending_verification'
             AND appointment.status NOT IN ('cancelled')`,
          appointmentScope.params
        ).catch((error) => {
          if (error?.code === "42703") return { rows: [{ count: "0" }] };
          throw error;
        })
      : hmoVerification
          .countPendingUnique(db, { branchId: options.branchId || null })
          .then((uniqueCount) => {
            if (uniqueCount != null) return { rows: [{ count: String(uniqueCount) }] };
            return db.query(
              `SELECT COUNT(*) AS count
               FROM patient_portal_appointments AS appointment
               WHERE ${appointmentScope.sql}
                 AND LOWER(COALESCE(appointment.coverage_type, '')) = 'hmo'
                 AND appointment.hmo_verification_status = 'pending_verification'
                 AND appointment.status NOT IN ('cancelled')`,
              appointmentScope.params
            );
          })
          .catch((error) => {
            if (error?.code === "42703" || error?.code === "42P01") return { rows: [{ count: "0" }] };
            throw error;
          }),
    db.query(
      `SELECT COUNT(*) AS count
       FROM patient_portal_queue_entries AS queue
       ${queueJoin}
       WHERE ${queueScope.sql}
         AND ${queueStatusSql("queue", "completed")}`,
      queueScope.params
    ),
    db.query(
      `SELECT COUNT(*) AS count
       FROM patient_portal_queue_entries AS queue
       ${queueJoin}
       WHERE ${queueScope.sql}
         AND ${queueStatusSql("queue", "no_show")}`,
      queueScope.params
    ),
  ]);

  const booked = count(bookedToday.rows[0]);
  const waitingCount = count(waiting.rows[0]);
  return {
    timezone: clinicTimezone(),
    clinicDate: clinicSchedule.clinicTodayYmd(),
    bookedToday: booked,
    todaysAppointments: booked,
    appointmentsToday: booked,
    checkedIn: count(checkedIn.rows[0]),
    waiting: waitingCount,
    waitingQueue: waitingCount,
    inTreatment: count(inTreatment.rows[0]),
    completedToday: count(completedToday.rows[0]),
    noShowToday: count(noShowToday.rows[0]),
    queueCompletedToday: count(queueCompleted.rows[0]),
    queueNoShowToday: count(queueNoShow.rows[0]),
    pendingRequests: count(pendingRequests.rows[0]),
    pendingHmoVerification: count(pendingHmo.rows[0]),
  };
}

async function loadSchedulePreview(db, options = {}) {
  const appointmentScope = scopeParts({ ...options, appointmentAlias: "appointment" });
  const sql = (withHmo) => `
    SELECT
      appointment.id AS appointment_id,
      appointment.appointment_time,
      appointment.status AS appointment_status,
      appointment.service_name,
      appointment.dentist_name,
      ${withHmo ? "appointment.coverage_type, appointment.hmo_verification_status," : "NULL AS coverage_type, NULL AS hmo_verification_status,"}
      queue.id AS queue_entry_id,
      queue.token,
      queue.status AS queue_status,
      patient.id AS patient_id,
      CONCAT_WS(' ', patient.first_name, patient.last_name) AS patient_name
    FROM patient_portal_appointments AS appointment
    JOIN users AS patient ON patient.id::text = appointment.user_id
    LEFT JOIN patient_portal_queue_entries AS queue
      ON queue.appointment_id = appointment.id
     AND ${clinicQueueTodaySql("queue")}
    WHERE ${appointmentScope.sql}
      AND ${appointmentTodaySql("appointment")}
      AND appointment.status NOT IN ('cancelled')
    ORDER BY
      appointment.appointment_time NULLS LAST,
      appointment.id ASC
    LIMIT 12`;
  let result;
  try {
    result = await db.query(sql(true), appointmentScope.params);
  } catch (error) {
    if (error?.code !== "42703") throw error;
    result = await db.query(sql(false), appointmentScope.params);
  }

  return result.rows.map((row) => {
    const clock = formatClock(row.appointment_time);
    return {
      appointmentId: row.appointment_id,
      patientId: row.patient_id,
      patientName: row.patient_name || "Patient",
      time: clock,
      timeLabel: clock || "Date only",
      service: row.service_name || "Dental visit",
      dentist: row.dentist_name || "Unassigned",
      appointmentStatus: row.appointment_status,
      queueEntryId: row.queue_entry_id || null,
      queueNumber: row.token || null,
      queueStatus: row.queue_status || null,
      coverageType: row.coverage_type || null,
      hmoVerificationStatus: row.hmo_verification_status || null,
    };
  });
}

function matchAvailabilityRow(row, dentist) {
  const keys = [String(dentist.id), dentist.catalogDentistId, dentist.fullName, dentist.name]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());
  const rowKeys = [row.dentist_id, row.dentist_name]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());
  return rowKeys.some((key) => keys.includes(key));
}

function matchTreatmentRow(row, dentist) {
  const keys = [String(dentist.id), dentist.catalogDentistId, dentist.fullName]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());
  const rowKeys = [row.dentist_id, row.dentist_name]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());
  return rowKeys.some((key) => keys.includes(key));
}

async function loadDentistAvailability(db, { branchId = null } = {}) {
  const clinicDate = clinicSchedule.clinicTodayYmd();
  const timezone = clinicTimezone();
  let hoursKnown = true;
  let clinicClosed = false;
  try {
    const defaults = await clinicSchedule.loadDefaults(db);
    const dayMap = await clinicSchedule.loadDayMap(db, clinicDate, clinicDate, branchId || null);
    const hours = clinicSchedule.resolveOperatingHours(clinicDate, dayMap.get(clinicDate), defaults);
    clinicClosed = Boolean(hours.closed);
  } catch (error) {
    if (error?.code !== "42P01" && error?.code !== "42703") throw error;
    hoursKnown = false;
  }

  let dentists = [];
  try {
    const dentistResult = await db.query(
      `SELECT
         account.id,
         account.first_name,
         account.last_name,
         profile.catalog_dentist_id,
         profile.schedule_notes,
         COALESCE(
           ARRAY_AGG(DISTINCT assignment.branch_id) FILTER (WHERE assignment.branch_id IS NOT NULL),
           ARRAY[]::bigint[]
         ) AS branch_ids,
         COALESCE(
           ARRAY_AGG(DISTINCT branch.name) FILTER (WHERE branch.name IS NOT NULL),
           ARRAY[]::text[]
         ) AS branch_names
       FROM users AS account
       LEFT JOIN admin_portal_dentist_profiles AS profile
         ON profile.user_id::text = account.id::text
       LEFT JOIN clinic_branch_assignments AS assignment
         ON assignment.user_id = account.id
       LEFT JOIN clinic_branches AS branch
         ON branch.id = assignment.branch_id
       WHERE LOWER(account.role) = 'dentist'
         AND COALESCE(account.is_archived, FALSE) = FALSE
         AND LOWER(COALESCE(account.status, 'active')) NOT IN ('inactive', 'disabled', 'suspended', 'rejected')
       GROUP BY account.id, account.first_name, account.last_name, profile.catalog_dentist_id, profile.schedule_notes
       ORDER BY account.last_name ASC, account.first_name ASC`
    );
    dentists = dentistResult.rows.map((row) => {
      const fullName = `Dr. ${`${row.first_name || ""} ${row.last_name || ""}`.trim()}`.trim();
      return {
        id: row.id,
        catalogDentistId: row.catalog_dentist_id || null,
        fullName: fullName === "Dr." ? "Dentist" : fullName,
        scheduleNotes: row.schedule_notes || null,
        branchIds: (row.branch_ids || []).map((value) => String(value)),
        branchNames: row.branch_names || [],
      };
    });
  } catch (error) {
    if (error?.code !== "42P01" && error?.code !== "42703") throw error;
    return {
      clinicDate,
      timezone,
      clinicClosed,
      dentists: [],
    };
  }

  let recorded = [];
  try {
    const recordedResult = await db.query(
      `SELECT dentist_id, dentist_name, start_time, end_time, status
       FROM staff_portal_dentist_availability
       WHERE availability_date = ${clinicDateSql()}`
    );
    recorded = recordedResult.rows;
  } catch (error) {
    if (error?.code !== "42P01" && error?.code !== "42703") throw error;
  }

  let treatments = [];
  try {
    const treatmentResult = await db.query(
      `SELECT appointment.dentist_id, appointment.dentist_name, queue.status
       FROM patient_portal_queue_entries AS queue
       JOIN patient_portal_appointments AS appointment
         ON appointment.id = queue.appointment_id
       WHERE ${clinicQueueTodaySql("queue")}
         AND queue.status IN ('preparing', 'dentist')
         ${branchId ? "AND queue.branch_id = $1" : ""}`,
      branchId ? [branchId] : []
    );
    treatments = treatmentResult.rows;
  } catch (error) {
    if (error?.code !== "42P01" && error?.code !== "42703") throw error;
  }

  const assignmentTableUsed = dentists.some((dentist) => dentist.branchIds.length);
  const visible = dentists.filter((dentist) => {
    if (!branchId) return true;
    if (!assignmentTableUsed) return true;
    return dentist.branchIds.includes(String(branchId));
  });

  return {
    clinicDate,
    timezone,
    clinicClosed,
    hoursKnown,
    dentists: visible.map((dentist) => {
      const record = recorded.find((row) => matchAvailabilityRow(row, dentist));
      const inTreatment = treatments.some((row) => matchTreatmentRow(row, dentist));
      let status = "unknown";
      let label = "Availability unknown";
      let detail = "Recorded hours, branch assignment, or an open clinic schedule are needed to establish availability.";

      if (inTreatment) {
        status = "in_treatment";
        label = "In treatment";
        detail = "This dentist has an ongoing visit in the live queue.";
      } else if (record) {
        const recordedStatus = String(record.status || "").toLowerCase();
        if (recordedStatus === "on_leave" || recordedStatus === "unavailable") {
          status = "unavailable";
          label = recordedStatus === "on_leave" ? "On leave" : "Unavailable";
          detail = `${formatClock(record.start_time) || "—"}–${formatClock(record.end_time) || "—"} on the recorded schedule.`;
        } else if (recordedStatus === "available") {
          if (clinicClosed && hoursKnown) {
            status = "unavailable";
            label = "Unavailable";
            detail = "The clinic schedule is closed for this date.";
          } else {
            status = "available";
            label = "Available";
            detail = `${formatClock(record.start_time) || "—"}–${formatClock(record.end_time) || "—"} · recorded schedule.`;
          }
        }
      } else if (clinicClosed && hoursKnown) {
        status = "unavailable";
        label = "Unavailable";
        detail = "The clinic schedule is closed for this date.";
      } else if (!hoursKnown && !record) {
        status = "unknown";
        label = "Availability unknown";
        detail = "Clinic hours could not be loaded for this date.";
      } else {
        status = "unknown";
        label = "Availability unknown";
        detail = dentist.branchNames.length
          ? `Assigned to ${dentist.branchNames.join(", ")}, but no recorded dentist hours for today.`
          : "No recorded dentist hours or branch assignment for today.";
      }

      return {
        id: dentist.id,
        catalogDentistId: dentist.catalogDentistId,
        name: dentist.fullName,
        branches: dentist.branchNames,
        status,
        label,
        detail,
      };
    }),
  };
}

async function resolveAdminDashboardBranch(db, rawId) {
  const branches = await clinicBranches.listBranches(db, { status: "all" }).catch(async (error) => {
    if (error?.code === "42P01") return [];
    throw error;
  });
  const active = branches.filter((branch) => String(branch.status || "active").toLowerCase() === "active");
  if (!rawId || String(rawId).toLowerCase() === "all") {
    return {
      branchId: null,
      branch: null,
      branches: active.length ? active : branches,
      label: "All branches",
    };
  }
  const found = branches.find((branch) => String(branch.id) === String(rawId));
  if (!found) {
    const error = new Error("Unknown clinic branch.");
    error.status = 400;
    throw error;
  }
  return {
    branchId: found.id,
    branch: found,
    branches: active.length ? active : branches,
    label: found.name,
  };
}

function clinicQueueOnDateSql(alias, dateRef) {
  const tz = clinicTimezone().replace(/'/g, "''");
  return `(${alias}.checked_in_at AT TIME ZONE '${tz}')::date = ${dateRef}::date`;
}

function buildAdminAppointmentMetricFilter(metric, { date, branchId } = {}) {
  const normalized = String(metric || "").toLowerCase();
  const clauses = [];
  const params = [];
  let joinQueue = false;
  const dateRef = date
    ? (() => {
        params.push(date);
        return `$${params.length}`;
      })()
    : clinicDateSql();

  if (branchId) {
    params.push(branchId);
    clauses.push(`appointment.branch_id::text = $${params.length}`);
  }

  if (normalized === "booked") {
    clauses.push(`appointment.appointment_date = ${dateRef}::date`);
    clauses.push(`appointment.status NOT IN ('cancelled', 'no_show')`);
  } else if (normalized === "completed") {
    clauses.push(`appointment.appointment_date = ${dateRef}::date`);
    clauses.push(`appointment.status = 'completed'`);
  } else if (normalized === "no_show") {
    clauses.push(`appointment.appointment_date = ${dateRef}::date`);
    clauses.push(`appointment.status = 'no_show'`);
  } else if (normalized === "checked_in" || normalized === "waiting" || normalized === "in_treatment") {
    joinQueue = true;
    clauses.push(clinicQueueOnDateSql("queue", dateRef));
    clauses.push(queueStatusSql("queue", normalized));
    if (branchId) {
      clauses.push(`queue.branch_id::text = $${params.length}`);
    }
  } else if (normalized === "hmo") {
    clauses.push(`LOWER(COALESCE(appointment.coverage_type, '')) = 'hmo'`);
    clauses.push(`appointment.hmo_verification_status = 'pending_verification'`);
    clauses.push(`appointment.status NOT IN ('cancelled')`);
  } else if (normalized) {
    const error = new Error("Unknown dashboard metric filter.");
    error.status = 400;
    throw error;
  }

  return {
    metric: normalized || null,
    joinQueue,
    sql: clauses.length ? clauses.join(" AND ") : "TRUE",
    params,
  };
}

module.exports = {
  clinicTimezone,
  clinicDateSql,
  clinicQueueTodaySql,
  activeQueueTodaySql,
  clinicQueueOnDateSql,
  appointmentTodaySql,
  queueStatusSql,
  buildAdminAppointmentMetricFilter,
  loadFloorMetrics,
  loadSchedulePreview,
  loadDentistAvailability,
  resolveAdminDashboardBranch,
};
