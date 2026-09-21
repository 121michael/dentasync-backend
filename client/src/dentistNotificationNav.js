/**
 * Resolve where a dentist notification should navigate when clicked.
 */
export function getDentistNotificationTarget(notification) {
  if (!notification) return null;

  const type = String(notification.type || "").toLowerCase();
  const entityType = String(notification.entityType || notification.entity_type || "").toLowerCase();
  const entityId = notification.entityId ?? notification.entity_id ?? null;
  const focus = entityId != null && String(entityId).trim() !== "" ? String(entityId) : null;

  if (type === "check_in" || entityType === "queue") {
    const params = new URLSearchParams({ tab: "inline" });
    if (focus) params.set("focus", focus);
    return {
      targetPage: "queue",
      path: `/dentist/queue?${params}`,
      label: "View queue",
    };
  }

  if (
    type === "appointment" ||
    type === "appointment_created" ||
    type === "appointment_cancelled" ||
    entityType === "appointment"
  ) {
    return {
      targetPage: "appointments",
      path: focus
        ? `/dentist/appointments?focus=${encodeURIComponent(focus)}`
        : "/dentist/appointments",
      label: "View appointment",
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
        ? `/dentist/patient-records?focus=${encodeURIComponent(focus)}`
        : "/dentist/patient-records",
      label: "View patient",
    };
  }

  return null;
}
