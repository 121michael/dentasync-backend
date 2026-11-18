"use strict";

const fs = require("fs");
const path = require("path");
const clinicSchedule = require("./clinicSchedule");

const NO_BRANCHES_MESSAGE =
  "No clinic branches are currently available for appointment booking. Please contact the clinic.";
const NO_WALK_IN_SLOTS_MESSAGE = "No walk-in slots available today";
const WALK_IN_DENTIST_CATALOG = [
  { id: "dr-sarah-cruz", name: "Dr. Sarah Cruz" },
  { id: "dr-sarah-mitchell", name: "Dr. Sarah Mitchell" },
  { id: "dr-james-reyes", name: "Dr. James Reyes" },
  { id: "dr-ana-santos", name: "Dr. Ana Santos" },
];

function bookingError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function mapBranch(row) {
  return {
    id: row.id,
    branchId: row.branch_code,
    name: row.name,
    status: row.status,
    isMain: Boolean(row.is_main),
    active: row.status === "active",
  };
}

function schedulePhrase(date, time) {
  const clock = clinicSchedule.normalizeTime(time == null ? "" : String(time));
  const day = String(date || "").slice(0, 10);
  return clock ? `${day} at ${clock}` : day;
}

async function applyPatientBranchBookingSchema(db) {
  const sqlPath = path.join(__dirname, "..", "migrations", "054_patient_branch_booking.sql");
  await db.query(fs.readFileSync(sqlPath, "utf8"));
}

async function loadActiveBranches(db) {
  const result = await db.query(
    `SELECT id, branch_code, name, status, is_main
     FROM clinic_branches
     WHERE status = 'active' /* patient_booking_active_branches */
     ORDER BY is_main DESC, name ASC, id ASC`
  );
  return result.rows.map(mapBranch);
}

async function loadBranchById(db, branchId) {
  const result = await db.query(
    `SELECT id, branch_code, name, status, is_main
     FROM clinic_branches
     WHERE id::text = $1
     LIMIT 1`,
    [String(branchId)]
  );
  return result.rows[0] ? mapBranch(result.rows[0]) : null;
}

async function publicBranchChoices(db) {
  try {
    const branches = await loadActiveBranches(db);
    return {
      branches,
      requiresSelection: branches.length > 1,
      autoSelectedBranchId: branches.length === 1 ? branches[0].id : null,
      message: branches.length ? null : NO_BRANCHES_MESSAGE,
    };
  } catch (error) {
    if (error?.code === "42P01") {
      return {
        legacy: true,
        branches: [],
        requiresSelection: false,
        autoSelectedBranchId: null,
        message: null,
      };
    }
    throw error;
  }
}

async function resolveBookingBranch(db, requestedId) {
  let choices;
  try {
    choices = await publicBranchChoices(db);
  } catch (error) {
    if (error?.code === "42P01") {
      return { legacy: true, branch: null, branches: [] };
    }
    throw error;
  }
  if (choices.legacy) {
    return { legacy: true, branch: null, branches: [] };
  }
  if (!choices.branches.length) {
    throw bookingError(NO_BRANCHES_MESSAGE, 409);
  }
  if (choices.branches.length === 1 && (requestedId == null || requestedId === "")) {
    return { branch: choices.branches[0], branches: choices.branches, autoSelected: true };
  }
  if (requestedId == null || requestedId === "") {
    throw bookingError("Select Clinic Branch.", 400);
  }
  const selected = choices.branches.find((branch) => String(branch.id) === String(requestedId));
  if (selected) {
    return { branch: selected, branches: choices.branches, autoSelected: choices.branches.length === 1 };
  }
  const existing = await loadBranchById(db, requestedId);
  if (existing && !existing.active) {
    throw bookingError("That clinic branch is not accepting new appointments.", 409);
  }
  throw bookingError("Select a valid clinic branch.", 400);
}

async function availabilityForBranch(db, { date, branchId }) {
  const resolved = await resolveBookingBranch(db, branchId);
  const scopedBranchId = resolved.branch?.id ?? null;
  const defaults = await clinicSchedule.loadDefaults(db);
  const dayMap = await clinicSchedule.loadDayMap(db, date, date, scopedBranchId);
  const hours = clinicSchedule.resolveOperatingHours(date, dayMap.get(date), defaults);
  const savedSlots = await clinicSchedule.loadSlotMap(db, date, scopedBranchId);
  const bookedTimes = await clinicSchedule.loadBookedTimes(db, date, scopedBranchId);
  const dateOnlyCount = await clinicSchedule.loadDateOnlyCount(db, date, scopedBranchId);
  const capacity = clinicSchedule.assessCapacity(hours, defaults, savedSlots, bookedTimes, dateOnlyCount);
  const slots = clinicSchedule.buildSlots(hours, defaults, savedSlots, bookedTimes, dateOnlyCount);
  return {
    date,
    branch: resolved.branch,
    closed: hours.closed,
    hours,
    slots,
    availableTimes: slots.filter((slot) => slot.bookable).map((slot) => slot.time),
    dateOnlyBookable: clinicSchedule.isDateOnlyBookable(hours, defaults, savedSlots, bookedTimes, dateOnlyCount),
    capacity: capacity.capacity,
    remaining: capacity.remaining,
  };
}

async function dentistsForBranch(client, branchId, catalog) {
  if (!branchId) return catalog;
  try {
    const result = await client.query(
      `SELECT account.id,
              CONCAT_WS(' ', account.first_name, account.last_name) AS name,
              profile.catalog_dentist_id
       FROM clinic_branch_assignments AS assignment
       JOIN users AS account ON account.id = assignment.user_id
       LEFT JOIN admin_portal_dentist_profiles AS profile
         ON profile.user_id::text = account.id::text
       WHERE assignment.branch_id = $1
         AND LOWER(account.role) = 'dentist'
         AND LOWER(COALESCE(account.status, 'active')) = 'active'
       ORDER BY account.last_name ASC, account.first_name ASC, account.id ASC`,
      [branchId]
    );
    if (result.rows.length) {
      return result.rows.map((row) => ({
        id: row.catalog_dentist_id || `dentist-${row.id}`,
        name: row.name || "Dentist",
      }));
    }
    const anyAssignment = await client.query(`SELECT 1 FROM clinic_branch_assignments LIMIT 1`);
    if (anyAssignment.rows.length) return [];
    return catalog;
  } catch (error) {
    if (error?.code === "42P01" || error?.code === "42703") return catalog;
    throw error;
  }
}

async function dentistIsFree(client, dentistId, date, time, ignoreAppointmentId) {
  if (!time) return true;
  const result = await client.query(
    `SELECT id
     FROM patient_portal_appointments
     WHERE dentist_id = $1
       AND appointment_date = $2::date
       AND appointment_time = $3::time
       AND status NOT IN ('cancelled', 'no_show', 'rescheduled')
       AND ($4::bigint IS NULL OR id <> $4)
     LIMIT 1`,
    [dentistId, date, time, ignoreAppointmentId || null]
  );
  return result.rows.length === 0;
}

async function chooseDentist(client, { branchId, date, time, catalog, ignoreAppointmentId }) {
  const dentists = await dentistsForBranch(client, branchId, catalog);
  if (!dentists.length) {
    throw bookingError("No dentists are assigned to this clinic branch.", 503);
  }
  for (const candidate of dentists) {
    if (await dentistIsFree(client, candidate.id, date, time, ignoreAppointmentId)) {
      return candidate;
    }
  }
  throw bookingError("No dentist at this branch is free at that time. Please choose another time.", 409);
}

async function lockBookingDay(client, branchId, date) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [
    `branch-booking:${branchId || "clinic"}`,
    String(date),
  ]);
}

async function claimEarliestWalkInSlot(client, { branchId, catalog } = {}) {
  if (!branchId) {
    throw bookingError(NO_WALK_IN_SLOTS_MESSAGE, 409);
  }
  const zone = process.env.CLINIC_TIMEZONE || "Asia/Manila";
  const clock = await client.query(
    `SELECT (CURRENT_TIMESTAMP AT TIME ZONE $1)::date::text AS clinic_today,
            TO_CHAR((CURRENT_TIMESTAMP AT TIME ZONE $1), 'HH24:MI') AS clinic_time`,
    [zone]
  );
  const date = clock.rows[0].clinic_today;
  const floor = clinicSchedule.normalizeTime(String(clock.rows[0].clinic_time || ""));
  await lockBookingDay(client, branchId, date);
  const defaults = await clinicSchedule.loadDefaults(client);
  const dayMap = await clinicSchedule.loadDayMap(client, date, date, branchId);
  const hours = clinicSchedule.resolveOperatingHours(date, dayMap.get(date), defaults);
  if (hours.closed) {
    throw bookingError(NO_WALK_IN_SLOTS_MESSAGE, 409);
  }
  const savedSlots = await clinicSchedule.loadSlotMap(client, date, branchId);
  const bookedTimes = await clinicSchedule.loadBookedTimes(client, date, branchId);
  const dateOnlyCount = await clinicSchedule.loadDateOnlyCount(client, date, branchId);
  const slots = clinicSchedule.buildSlots(hours, defaults, savedSlots, bookedTimes, dateOnlyCount);
  const available = slots.filter((slot) => slot.bookable && (!floor || slot.time >= floor));
  const dentistCatalog = Array.isArray(catalog) && catalog.length ? catalog : WALK_IN_DENTIST_CATALOG;
  for (const slot of available) {
    try {
      const dentist = await chooseDentist(client, {
        branchId,
        date,
        time: slot.time,
        catalog: dentistCatalog,
      });
      await assertPlaceAvailable(client, { branchId, date, time: slot.time });
      return { date, time: slot.time, dentist };
    } catch (error) {
      if (error.status === 409 || error.status === 503) {
        continue;
      }
      throw error;
    }
  }
  throw bookingError(NO_WALK_IN_SLOTS_MESSAGE, 409);
}

async function assertPlaceAvailable(client, { branchId, date, time, ignoreAppointmentId }) {
  const defaults = await clinicSchedule.loadDefaults(client);
  const dayMap = await clinicSchedule.loadDayMap(client, date, date, branchId);
  const hours = clinicSchedule.resolveOperatingHours(date, dayMap.get(date), defaults);
  const savedSlots = await clinicSchedule.loadSlotMap(client, date, branchId);
  const bookedTimes = await clinicSchedule.loadBookedTimes(client, date, branchId);
  let dateOnlyCount = await clinicSchedule.loadDateOnlyCount(client, date, branchId);
  if (ignoreAppointmentId) {
    const ignored = await client.query(
      `SELECT appointment_time
       FROM patient_portal_appointments
       WHERE id = $1
         AND appointment_date = $2::date
         AND LOWER(COALESCE(status, 'pending')) <> 'cancelled'
       LIMIT 1`,
      [ignoreAppointmentId, date]
    );
    if (ignored.rows[0] && ignored.rows[0].appointment_time == null) {
      dateOnlyCount = Math.max(0, dateOnlyCount - 1);
    }
    if (ignored.rows[0]?.appointment_time) {
      const ignoredTime = clinicSchedule.normalizeTime(String(ignored.rows[0].appointment_time).slice(0, 5));
      const current = Number(bookedTimes.get(ignoredTime) || 0);
      if (current > 0) bookedTimes.set(ignoredTime, current - 1);
    }
  }
  if (hours.closed) {
    throw bookingError("The clinic is closed on that date. Please choose another day.", 409);
  }
  if (time) {
    if (!clinicSchedule.isSlotBookable(hours, defaults, savedSlots, bookedTimes, time, dateOnlyCount)) {
      throw bookingError("That time is outside clinic hours or is not available. Please choose another slot.", 409);
    }
  } else if (!clinicSchedule.isDateOnlyBookable(hours, defaults, savedSlots, bookedTimes, dateOnlyCount)) {
    throw bookingError("That date is fully booked. Please choose another day.", 409);
  }
}

async function queryOrRollback(client, sql, params) {
  await client.query("SAVEPOINT booking_insert");
  try {
    const result = await client.query(sql, params);
    await client.query("RELEASE SAVEPOINT booking_insert");
    return result;
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT booking_insert");
    throw error;
  }
}

async function insertAppointment(client, values) {
  const params = [
    values.userId,
    values.service.id,
    values.service.name,
    values.dentist.id,
    values.dentist.name,
    values.appointmentDate,
    values.appointmentTime,
    values.coverageType,
    values.hmoProvider,
    values.hmoMemberNumber,
    values.hmoCompanyName,
    values.hmoBirthDate,
    values.hmoVerificationStatus,
    values.authorizationDocumentId,
    values.service.estimatedCost,
    values.notes,
    values.status || "pending",
    values.branchId,
    values.clinicLocation || null,
    values.rescheduledFromId || null,
  ];
  try {
    return await queryOrRollback(client,
      `INSERT INTO patient_portal_appointments (
         user_id, service_id, service_name, dentist_id, dentist_name,
         appointment_date, appointment_time, coverage_type, hmo_provider,
         hmo_member_number, hmo_company_name, hmo_birth_date, hmo_verification_status,
         authorization_document_id, estimated_cost, notes, status, branch_id,
         clinic_location, rescheduled_from_id
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
       )
       RETURNING *`,
      params
    );
  } catch (error) {
    if (error?.code !== "42703") throw error;
  }
  try {
    return await queryOrRollback(client,
      `INSERT INTO patient_portal_appointments (
         user_id, service_id, service_name, dentist_id, dentist_name,
         appointment_date, appointment_time, coverage_type, hmo_provider,
         hmo_member_number, hmo_company_name, hmo_birth_date, hmo_verification_status,
         authorization_document_id, estimated_cost, notes, status, branch_id
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
       )
       RETURNING *`,
      params.slice(0, 18)
    );
  } catch (error) {
    if (error?.code !== "42703") throw error;
  }
  try {
    return await queryOrRollback(client,
      `INSERT INTO patient_portal_appointments (
         user_id, service_id, service_name, dentist_id, dentist_name,
         appointment_date, appointment_time, coverage_type, hmo_provider,
         hmo_member_number, authorization_document_id, estimated_cost, notes, status, branch_id
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
       )
       RETURNING *`,
      [
        values.userId,
        values.service.id,
        values.service.name,
        values.dentist.id,
        values.dentist.name,
        values.appointmentDate,
        values.appointmentTime,
        values.coverageType,
        values.hmoProvider,
        values.hmoMemberNumber,
        values.authorizationDocumentId,
        values.service.estimatedCost,
        values.notes,
        values.status || "pending",
        values.branchId,
      ]
    );
  } catch (error) {
    if (error?.code !== "42703") throw error;
  }
  return queryOrRollback(client,
    `INSERT INTO patient_portal_appointments (
       user_id, service_id, service_name, dentist_id, dentist_name,
       appointment_date, appointment_time, coverage_type, hmo_provider,
       hmo_member_number, authorization_document_id, estimated_cost, notes, status
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
     )
     RETURNING *`,
    [
      values.userId,
      values.service.id,
      values.service.name,
      values.dentist.id,
      values.dentist.name,
      values.appointmentDate,
      values.appointmentTime,
      values.coverageType,
      values.hmoProvider,
      values.hmoMemberNumber,
      values.authorizationDocumentId,
      values.service.estimatedCost,
      values.notes,
      values.status || "pending",
    ]
  );
}

async function createBooking(db, input) {
  const resolved = await resolveBookingBranch(db, input.branchId);
  const client = await db.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    const branchId = resolved.branch?.id || null;
    await lockBookingDay(client, branchId, input.appointmentDate);
    await assertPlaceAvailable(client, {
      branchId,
      date: input.appointmentDate,
      time: input.appointmentTime,
    });
    const dentist = input.dentist
      ? input.dentist
      : await chooseDentist(client, {
          branchId,
          date: input.appointmentDate,
          time: input.appointmentTime,
          catalog: input.catalog || [],
        });
    if (input.appointmentTime && !(await dentistIsFree(client, dentist.id, input.appointmentDate, input.appointmentTime))) {
      throw bookingError("That time was just booked. Please choose another available slot.", 409);
    }
    const inserted = await insertAppointment(client, {
      ...input,
      dentist,
      branchId,
      status: "pending",
      clinicLocation: input.clinicLocation || resolved.branch?.name || "Amethyst Dental Clinic",
    });
    await client.query("COMMIT");
    open = false;
    return { appointment: inserted.rows[0], branch: resolved.branch };
  } catch (error) {
    if (open) await client.query("ROLLBACK");
    if (error?.code === "23505") {
      throw bookingError("That time was just booked. Please choose another available slot.", 409);
    }
    throw error;
  } finally {
    client.release();
  }
}

async function rescheduleBooking(db, { current, appointmentDate, appointmentTime, catalog }) {
  if (!current?.id) throw bookingError("Appointment not found.", 404);
  const branchId = current.branch_id || null;
  if (branchId) {
    const branch = await loadBranchById(db, branchId);
    if (!branch) throw bookingError("The original clinic branch could not be found.", 409);
  }
  const client = await db.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    await lockBookingDay(client, branchId, appointmentDate);
    await assertPlaceAvailable(client, {
      branchId,
      date: appointmentDate,
      time: appointmentTime,
      ignoreAppointmentId: current.id,
    });
    const sameDentistFree =
      !appointmentTime ||
      (await dentistIsFree(client, current.dentist_id, appointmentDate, appointmentTime, current.id));
    const dentist = sameDentistFree
      ? { id: current.dentist_id, name: current.dentist_name }
      : await chooseDentist(client, {
          branchId,
          date: appointmentDate,
          time: appointmentTime,
          catalog,
          ignoreAppointmentId: current.id,
        });
    const nextStatus = current.status === "pending" ? "pending" : "confirmed";
    const inserted = await insertAppointment(client, {
      userId: current.user_id,
      service: {
        id: current.service_id,
        name: current.service_name,
        estimatedCost: current.estimated_cost,
      },
      dentist,
      appointmentDate,
      appointmentTime,
      coverageType: current.coverage_type,
      hmoProvider: current.hmo_provider,
      hmoMemberNumber: current.hmo_member_number,
      hmoCompanyName: current.hmo_company_name,
      hmoBirthDate: current.hmo_birth_date,
      hmoVerificationStatus: current.hmo_verification_status,
      authorizationDocumentId: current.authorization_document_id,
      notes: current.notes,
      status: nextStatus,
      branchId,
      clinicLocation: current.clinic_location,
      rescheduledFromId: current.id,
    });
    let original;
    try {
      original = await client.query(
        `UPDATE patient_portal_appointments
         SET status = 'rescheduled',
             rescheduled_to_id = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING *`,
        [current.id, inserted.rows[0].id]
      );
    } catch (schemaError) {
      if (schemaError.code !== "42703") throw schemaError;
      original = await client.query(
        `UPDATE patient_portal_appointments
         SET status = 'cancelled',
             notes = LEFT(CONCAT_WS(E'\\n', NULLIF(notes, ''), 'Rescheduled to a new visit.'), 1200),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING *`,
        [current.id]
      );
    }
    await client.query("COMMIT");
    open = false;
    return { appointment: inserted.rows[0], original: original.rows[0], branchId };
  } catch (error) {
    if (open) await client.query("ROLLBACK");
    if (error?.code === "23505") {
      throw bookingError("That time was just booked. Please choose another available slot.", 409);
    }
    throw error;
  } finally {
    client.release();
  }
}

async function listInactiveBranchReview(db) {
  const result = await db.query(
    `SELECT
       appointment.*,
       CONCAT_WS(' ', patient.first_name, patient.last_name) AS patient_name,
       patient.email AS patient_email,
       patient.phone AS patient_phone,
       branch.name AS branch_name,
       branch.branch_code,
       branch.status AS branch_status,
       branch.is_main
     FROM patient_portal_appointments AS appointment
     JOIN users AS patient ON patient.id::text = appointment.user_id
     JOIN clinic_branches AS branch ON branch.id = appointment.branch_id
     WHERE appointment.appointment_date >= CURRENT_DATE
       AND appointment.status IN ('pending', 'confirmed', 'checked_in')
       AND branch.status = 'inactive'
     ORDER BY appointment.appointment_date ASC, appointment.appointment_time ASC NULLS LAST, appointment.id ASC`
  );
  return result.rows;
}

module.exports = {
  NO_BRANCHES_MESSAGE,
  NO_WALK_IN_SLOTS_MESSAGE,
  claimEarliestWalkInSlot,
  schedulePhrase,
  applyPatientBranchBookingSchema,
  publicBranchChoices,
  resolveBookingBranch,
  availabilityForBranch,
  createBooking,
  rescheduleBooking,
  listInactiveBranchReview,
};
