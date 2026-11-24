"use strict";

// Preview-only. Does not UPDATE production rows.
// Lists checked-in appointments whose clinic date is already over so Staff can
// review leftover queue visits through the existing needs_review workflow.
// Run from backend/: node scripts/preview-stale-checked-in-visits.js

const db = require("../db");

const tz = process.env.CLINIC_TIMEZONE || "Asia/Manila";

async function main() {
  const result = await db.query(
    `SELECT
       appointment.id,
       appointment.user_id,
       appointment.service_name,
       appointment.appointment_date::text AS appointment_date,
       appointment.status AS appointment_status,
       appointment.branch_id,
       queue.id AS queue_id,
       queue.status AS queue_status,
       queue.checked_in_at,
       queue.closed_operating_date
     FROM patient_portal_appointments AS appointment
     LEFT JOIN LATERAL (
       SELECT id, status, checked_in_at, closed_operating_date
       FROM patient_portal_queue_entries
       WHERE appointment_id = appointment.id
       ORDER BY checked_in_at DESC
       LIMIT 1
     ) AS queue ON TRUE
     WHERE appointment.status = 'checked_in'
       AND appointment.appointment_date < (CURRENT_TIMESTAMP AT TIME ZONE $1)::date
     ORDER BY appointment.appointment_date DESC, appointment.id DESC
     LIMIT 200`,
    [tz]
  );
  const rows = result.rows || [];
  const notServed = rows.filter((row) => row.queue_status === "not_served").length;
  const needsReview = rows.filter((row) => row.queue_status === "needs_review").length;
  const stillActive = rows.filter((row) =>
    ["checked_in", "waiting", "preparing", "dentist"].includes(String(row.queue_status || ""))
  ).length;
  console.log(
    JSON.stringify(
      {
        timezone: tz,
        previewOnly: true,
        count: rows.length,
        notServed,
        needsReview,
        stillActiveQueue: stillActive,
        sample: rows.slice(0, 20).map((row) => ({
          appointmentId: row.id,
          date: row.appointment_date,
          service: row.service_name,
          appointmentStatus: row.appointment_status,
          queueStatus: row.queue_status,
        })),
        recommendation:
          "Do not bulk-update these to completed, cancelled, or no-show. Keep historical rows. Patient UI overlays Not served / Needs review. Still-active leftovers belong to queue day closure (npm run migrate:queue-day-closure) and dentist review.",
      },
      null,
      2
    )
  );
  await db.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
