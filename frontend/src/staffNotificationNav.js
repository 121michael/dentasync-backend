/**
 * Resolve where a staff notification should navigate when clicked.
 * Uses structured type/entity fields — not message text.
 */
export function getStaffNotificationTarget(notification) {
  if (!notification) return null;

  const type = String(notification.type || "").toLowerCase();
  const entityType = String(notification.entityType || notification.entity_type || "").toLowerCase();
  const entityId = notification.entityId ?? notification.entity_id ?? null;
  const title = String(notification.title || "");
  const focus = entityId != null && String(entityId).trim() !== "" ? String(entityId) : null;

  if (type === "check_in" || entityType === "queue") {
    return {
      targetPage: "queue",
      path: focus ? `/staff/queue?focus=${encodeURIComponent(focus)}` : "/staff/queue",
      label: "View queue",
    };
  }

  if (
    type === "appointment" ||
    type === "appointment_created" ||
    type === "appointment_cancelled" ||
    entityType === "appointment"
  ) {
    const params = new URLSearchParams();
    if (/cancel/i.test(type) || /cancel/i.test(title)) {
      params.set("tab", "cancelled");
    } else if (/new appointment request|booking from/i.test(title) || type === "appointment_created") {
      params.set("tab", "pending");
    }
    if (focus) params.set("focus", focus);
    const query = params.toString();
    return {
      targetPage: "appointments",
      path: query ? `/staff/appointments?${query}` : "/staff/appointments",
      label: "View appointment",
    };
  }

  if (type === "billing" || type === "payment" || entityType === "billing" || entityType === "invoice") {
    return {
      targetPage: "billing",
      path: focus ? `/staff/billing?focus=${encodeURIComponent(focus)}` : "/staff/billing",
      label: "View billing",
    };
  }

  if (
    type === "patient" ||
    entityType === "clinical_patient" ||
    entityType === "patient"
  ) {
    return {
      targetPage: "patient-records",
      path: focus
        ? `/staff/patient-records?focus=${encodeURIComponent(focus)}`
        : "/staff/patient-records",
      label: "View patient",
    };
  }

  if (type === "document" || entityType === "document") {
    return {
      targetPage: "appointments",
      path: "/staff/appointments?tab=pending",
      label: "View appointments",
    };
  }

  return null;
}
