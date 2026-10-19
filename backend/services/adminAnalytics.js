"use strict";

const { loadAiUsageAnalytics, emptyAiUsage, periodLabel } = require("./aiUsage");

function count(row, key = "count") {
  return Number.parseInt(row?.[key] || "0", 10);
}

function isMissingRelation(error) {
  return error?.code === "42P01";
}

function revenueSqlForRange(range) {
  if (range === "today") {
    return {
      sql: `
        SELECT TO_CHAR(appointment_date, 'YYYY-MM-DD') AS label,
               COALESCE(SUM(estimated_cost), 0) AS value
        FROM patient_portal_appointments
        WHERE status = 'completed'
          AND appointment_date = CURRENT_DATE
        GROUP BY appointment_date
        ORDER BY appointment_date`,
      params: [],
    };
  }
  if (range === "week") {
    return {
      sql: `
        SELECT TO_CHAR(appointment_date, 'YYYY-MM-DD') AS label,
               COALESCE(SUM(estimated_cost), 0) AS value
        FROM patient_portal_appointments
        WHERE status = 'completed'
          AND appointment_date >= CURRENT_DATE - INTERVAL '6 days'
          AND appointment_date <= CURRENT_DATE
        GROUP BY appointment_date
        ORDER BY appointment_date`,
      params: [],
    };
  }
  if (range === "month") {
    return {
      sql: `
        SELECT TO_CHAR(date_trunc('week', appointment_date), 'IYYY-"W"IW') AS label,
               COALESCE(SUM(estimated_cost), 0) AS value
        FROM patient_portal_appointments
        WHERE status = 'completed'
          AND appointment_date >= date_trunc('month', CURRENT_DATE)
          AND appointment_date < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
        GROUP BY date_trunc('week', appointment_date)
        ORDER BY date_trunc('week', appointment_date)`,
      params: [],
    };
  }
  if (range === "custom") {
    return {
      sql: `
        SELECT TO_CHAR(appointment_date, 'YYYY-MM-DD') AS label,
               COALESCE(SUM(estimated_cost), 0) AS value
        FROM patient_portal_appointments
        WHERE status = 'completed'
          AND appointment_date >= $1::date
          AND appointment_date <= $2::date
        GROUP BY appointment_date
        ORDER BY appointment_date`,
      params: null,
    };
  }
  return {
    sql: `
      SELECT TO_CHAR(date_trunc('month', appointment_date), 'YYYY-MM') AS label,
             COALESCE(SUM(estimated_cost), 0) AS value
      FROM patient_portal_appointments
      WHERE status = 'completed'
        AND appointment_date >= date_trunc('year', CURRENT_DATE)
        AND appointment_date < date_trunc('year', CURRENT_DATE) + INTERVAL '1 year'
      GROUP BY date_trunc('month', appointment_date)
      ORDER BY date_trunc('month', appointment_date)`,
    params: [],
  };
}

async function loadAdminAnalytics(db, { range = "month", from = null, to = null } = {}) {
  const revenue = revenueSqlForRange(range);
  const revenueParams = range === "custom" ? [from, to] : revenue.params || [];

  const [revenueResult, breakdownResult, growthResult, dentistResult, volumeResult, queueResult, aiUsage] =
    await Promise.all([
      db.query(revenue.sql, revenueParams),
      db.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'completed') AS completed,
           COUNT(*) FILTER (WHERE status = 'pending') AS pending,
           COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
           COUNT(*) FILTER (WHERE status = 'no_show') AS no_show,
           COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed,
           COUNT(*) FILTER (WHERE status = 'checked_in') AS checked_in,
           COUNT(*) AS total,
           COALESCE(SUM(estimated_cost) FILTER (WHERE status = 'completed'), 0) AS revenue
         FROM patient_portal_appointments`
      ),
      db.query(
        `SELECT TO_CHAR(date_trunc('month', created_at), 'YYYY-MM') AS label,
                COUNT(*) AS count
         FROM users
         WHERE LOWER(role) = 'patient'
           AND COALESCE(is_archived, FALSE) = FALSE
           AND created_at >= date_trunc('month', CURRENT_TIMESTAMP) - INTERVAL '5 months'
         GROUP BY date_trunc('month', created_at)
         ORDER BY date_trunc('month', created_at)`
      ),
      db.query(
        `SELECT
           COALESCE(dentist_name, 'Unassigned') AS dentist,
           COUNT(*) FILTER (WHERE status = 'completed') AS completed,
           COUNT(*) AS total
         FROM patient_portal_appointments
         GROUP BY dentist_name
         ORDER BY completed DESC, total DESC, dentist ASC
         LIMIT 20`
      ),
      db.query(
        `SELECT TO_CHAR(appointment_date, 'YYYY-MM-DD') AS label,
                COUNT(*) AS count
         FROM patient_portal_appointments
         WHERE appointment_date >= CURRENT_DATE - INTERVAL '13 days'
           AND appointment_date <= CURRENT_DATE
         GROUP BY appointment_date
         ORDER BY appointment_date`
      ),
      db
        .query(
          `SELECT
             COUNT(*) FILTER (WHERE status IN ('checked_in', 'waiting', 'preparing', 'dentist')) AS active,
             COUNT(*) FILTER (WHERE status = 'completed') AS completed,
             COUNT(*) AS total,
             COALESCE(AVG(EXTRACT(EPOCH FROM (updated_at - checked_in_at)) / 60)
               FILTER (WHERE checked_in_at IS NOT NULL AND status = 'completed'), 0) AS avg_wait_minutes
           FROM patient_portal_queue_entries
           WHERE checked_in_at >= CURRENT_DATE - INTERVAL '7 days'`
        )
        .catch((error) => {
          if (isMissingRelation(error)) {
            return { rows: [{ active: "0", completed: "0", total: "0", avg_wait_minutes: "0" }] };
          }
          throw error;
        }),
      loadAiUsageAnalytics(db, { range, from, to }).catch((error) => {
        if (isMissingRelation(error)) {
          return emptyAiUsage(range, from, to, { trackingAvailable: false });
        }
        throw error;
      }),
    ]);

  const breakdown = breakdownResult.rows[0] || {};
  const queue = queueResult.rows[0] || {};
  const completed = count(breakdown, "completed");
  const noShow = count(breakdown, "no_show");
  const cancelled = count(breakdown, "cancelled");
  const totalAppointments = count(breakdown, "total") || 1;
  const satisfaction = Math.max(
    0,
    Math.min(
      100,
      Number(
        (
          ((completed + count(breakdown, "confirmed") + count(breakdown, "checked_in")) / totalAppointments) * 100 -
          ((cancelled + noShow) / totalAppointments) * 20
        ).toFixed(1)
      )
    )
  );

  const generatedAt = new Date().toISOString();
  return {
    range,
    from: from || null,
    to: to || null,
    periodLabel: periodLabel(range, from, to),
    generatedAt,
    summary: {
      totalRevenue: Number(breakdown.revenue || 0),
      patientSatisfaction: satisfaction,
      totalAppointments: count(breakdown, "total"),
      completedAppointments: completed,
      cancelledAppointments: cancelled,
      noShowAppointments: noShow,
      patientGrowth: growthResult.rows.reduce((sum, row) => sum + count(row, "count"), 0),
      queueActive: count(queue, "active"),
      queueCompleted: count(queue, "completed"),
      averageWaitMinutes: Number(Number(queue.avg_wait_minutes || 0).toFixed(1)),
    },
    revenueByPeriod: revenueResult.rows.map((row) => ({
      label: row.label,
      value: Number(row.value || 0),
    })),
    appointmentBreakdown: {
      completed,
      pending: count(breakdown, "pending"),
      cancelled,
      no_show: noShow,
      confirmed: count(breakdown, "confirmed"),
      checked_in: count(breakdown, "checked_in"),
    },
    patientGrowth: growthResult.rows.map((row) => ({
      label: row.label,
      count: count(row, "count"),
    })),
    patientVolume: volumeResult.rows.map((row) => ({
      label: row.label,
      count: count(row, "count"),
    })),
    dentistPerformance: dentistResult.rows.map((row) => ({
      dentist: row.dentist,
      completed: count(row, "completed"),
      total: count(row, "total"),
    })),
    queuePerformance: {
      active: count(queue, "active"),
      completed: count(queue, "completed"),
      total: count(queue, "total"),
      averageWaitMinutes: Number(Number(queue.avg_wait_minutes || 0).toFixed(1)),
    },
    aiUsage,
  };
}

module.exports = {
  loadAdminAnalytics,
  isMissingRelation,
};
