"use strict";

function resolvedBranchSql(alias) {
  return `(
    CASE
      WHEN ${alias}.entity_type = 'appointment' THEN (
        SELECT appointment.branch_id
        FROM patient_portal_appointments AS appointment
        WHERE appointment.id::text = ${alias}.entity_id
        LIMIT 1
      )
      WHEN ${alias}.entity_type = 'queue' THEN (
        SELECT COALESCE(queue.branch_id, appointment.branch_id)
        FROM patient_portal_queue_entries AS queue
        LEFT JOIN patient_portal_appointments AS appointment
          ON appointment.id = queue.appointment_id
        WHERE queue.id::text = ${alias}.entity_id
        LIMIT 1
      )
      ELSE NULL
    END
  )`;
}

/**
 * Appointment and queue notices are visible only for the viewer's branch.
 * A notice whose visit cannot be resolved stays visible only when the viewer
 * has no assigned branch, so older rows without a visit are not treated as
 * another branch's operational data.
 */
function visibleNotificationSql(alias, branchId, paramIndex) {
  const resolved = resolvedBranchSql(alias);
  const operational = `COALESCE(${alias}.entity_type, '') IN ('appointment', 'queue')`;
  if (branchId == null || branchId === "") {
    return `AND (NOT (${operational}) OR ${resolved} IS NULL)`;
  }
  return `AND (NOT (${operational}) OR ${resolved} = $${paramIndex})`;
}

/**
 * Prescription notices follow the branch stored when the dentist sent them.
 * A notice with no branch, including older broadcasts, stays out of every
 * branch inbox. Appointment and queue visibility is unchanged.
 */
function staffPrescriptionNoticeSql(alias, branchId, paramIndex) {
  const prescription = `(COALESCE(${alias}.type, '') = 'prescription' OR COALESCE(${alias}.entity_type, '') = 'prescription')`;
  if (branchId == null || branchId === "") {
    return `AND NOT ${prescription}`;
  }
  return `AND (NOT ${prescription} OR ${alias}.branch_id = $${paramIndex})`;
}

module.exports = {
  resolvedBranchSql,
  visibleNotificationSql,
  staffPrescriptionNoticeSql,
};
