"use strict";

const MAX_SERVICES = 3;
const DEFAULT_DURATION_MINUTES = 30;

function bookingError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function uniqueIds(values) {
  const seen = new Set();
  const ids = [];
  for (const value of values || []) {
    const id = String(value || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function requestedServiceIds(body) {
  const fromArray = uniqueIds(Array.isArray(body?.serviceIds) ? body.serviceIds : []);
  if (fromArray.length) return fromArray;
  const single = String(body?.serviceId || "").trim();
  return single ? [single] : [];
}

function resolveSelectedServices(requestedIds, catalog) {
  const ids = uniqueIds(requestedIds);
  if (!ids.length) {
    throw bookingError("Please select a treatment.");
  }
  if (ids.length > MAX_SERVICES) {
    throw bookingError(`You can select up to ${MAX_SERVICES} services for one appointment.`);
  }
  const byId = new Map((catalog || []).map((service) => [String(service.id), service]));
  const services = [];
  for (const id of ids) {
    const service = byId.get(id);
    if (!service || service.bookable === false) {
      throw bookingError("Please select a treatment.");
    }
    services.push({
      id: service.id,
      name: service.name,
      description: service.description || "",
      estimatedCost: Number(service.estimatedCost) || 0,
      durationMinutes: Math.max(Number(service.durationMinutes) || DEFAULT_DURATION_MINUTES, 1),
    });
  }
  return services;
}

function totalDurationMinutes(services) {
  return (services || []).reduce(
    (sum, service) => sum + Math.max(Number(service.durationMinutes) || DEFAULT_DURATION_MINUTES, 1),
    0
  );
}

function totalEstimatedCost(services) {
  return (services || []).reduce((sum, service) => sum + (Number(service.estimatedCost) || 0), 0);
}

function compoundServiceName(services) {
  return (services || []).map((service) => service.name).filter(Boolean).join(" · ");
}

function slotsNeeded(durationMinutes, slotMinutes = DEFAULT_DURATION_MINUTES) {
  const step = Number.parseInt(slotMinutes, 10);
  const duration = Math.max(Number(durationMinutes) || step || DEFAULT_DURATION_MINUTES, 1);
  const size = Number.isFinite(step) && step >= 5 ? step : DEFAULT_DURATION_MINUTES;
  return Math.max(1, Math.ceil(duration / size));
}

function primaryService(services) {
  return services[0];
}

async function saveForAppointment(client, appointmentId, services) {
  if (!appointmentId || !services?.length) return;
  await client.query("SAVEPOINT booking_services");
  try {
    await client.query(`DELETE FROM patient_portal_appointment_services WHERE appointment_id = $1`, [appointmentId]);
    for (let index = 0; index < services.length; index += 1) {
      const service = services[index];
      await client.query(
        `INSERT INTO patient_portal_appointment_services (
           appointment_id, service_id, service_name, sort_order, duration_minutes, estimated_cost
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          appointmentId,
          service.id,
          service.name,
          index,
          Math.max(Number(service.durationMinutes) || DEFAULT_DURATION_MINUTES, 1),
          Number(service.estimatedCost) || 0,
        ]
      );
    }
    await client.query("RELEASE SAVEPOINT booking_services");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT booking_services").catch(() => {});
    if (error?.code === "42P01" || error?.code === "42703") return;
    throw error;
  }
}

async function loadForAppointments(db, appointmentIds) {
  const ids = (appointmentIds || []).filter((id) => id != null);
  if (!ids.length) return new Map();
  try {
    const result = await db.query(
      `SELECT appointment_id, service_id, service_name, sort_order, duration_minutes, estimated_cost
       FROM patient_portal_appointment_services
       WHERE appointment_id = ANY($1::bigint[])
       ORDER BY appointment_id ASC, sort_order ASC, id ASC`,
      [ids]
    );
    const grouped = new Map();
    for (const row of result.rows) {
      const key = String(row.appointment_id);
      const list = grouped.get(key) || [];
      list.push({
        id: row.service_id,
        name: row.service_name,
        durationMinutes: Number(row.duration_minutes) || DEFAULT_DURATION_MINUTES,
        estimatedCost: Number(row.estimated_cost) || 0,
        sortOrder: Number(row.sort_order) || 0,
      });
      grouped.set(key, list);
    }
    return grouped;
  } catch (error) {
    if (error?.code === "42P01" || error?.code === "42703") return new Map();
    throw error;
  }
}

function fallbackServices(row) {
  if (!row?.service_id && !row?.service_name) return [];
  return [
    {
      id: row.service_id,
      name: row.service_name,
      durationMinutes: Number(row.duration_minutes) || DEFAULT_DURATION_MINUTES,
      estimatedCost: Number(row.estimated_cost) || 0,
      sortOrder: 0,
    },
  ];
}

function decorateRow(row, services) {
  const list = services?.length ? services : fallbackServices(row);
  if (!list.length) return { ...row, services: [] };
  return {
    ...row,
    services: list,
    service_id: list[0].id,
    service_name: compoundServiceName(list),
    duration_minutes: totalDurationMinutes(list),
    estimated_cost: totalEstimatedCost(list),
  };
}

async function decorateRows(db, rows) {
  if (!rows?.length) return [];
  const grouped = await loadForAppointments(
    db,
    rows.map((row) => row.id)
  );
  return rows.map((row) => decorateRow(row, grouped.get(String(row.id))));
}

module.exports = {
  MAX_SERVICES,
  DEFAULT_DURATION_MINUTES,
  requestedServiceIds,
  resolveSelectedServices,
  totalDurationMinutes,
  totalEstimatedCost,
  compoundServiceName,
  slotsNeeded,
  primaryService,
  saveForAppointment,
  loadForAppointments,
  decorateRow,
  decorateRows,
};
