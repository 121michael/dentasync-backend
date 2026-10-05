/**
 * Resolve where a patient notification should navigate when clicked.
 */
export function getPatientNotificationTarget(notification) {
  if (!notification) return null;

  const type = String(notification.type || "").toLowerCase();
  const entityType = String(notification.entityType || notification.entity_type || "").toLowerCase();
  const entityId = notification.entityId ?? notification.entity_id ?? null;
  const title = String(notification.title || "");
  const focus = entityId != null && String(entityId).trim() !== "" ? String(entityId) : null;

  if (type === "queue" || type === "check_in" || entityType === "queue") {
    return {
      targetPage: "queue",
      path: "/queue",
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
      path: focus ? `/appointments?focus=${encodeURIComponent(focus)}` : "/appointments",
      label: "View appointment",
    };
  }

  if (type === "family" || type === "dependent" || /dependent/i.test(title)) {
    return {
      targetPage: "family",
      path: "/family",
      label: "View family",
    };
  }

  if (type === "document" || entityType === "document") {
    return {
      targetPage: "appointments",
      path: "/appointments",
      label: "View appointments",
    };
  }

  return null;
}
