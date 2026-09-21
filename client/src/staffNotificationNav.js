export function getStaffNotificationTarget(notification) {
  if (!notification) return null;

  const type = String(notification.type || "").toLowerCase();
  const entityType = String(notification.entityType || notification.entity_type || "").toLowerCase();
  const entityId = notification.entityId ?? notification.entity_id ?? null;
  const title = String(notification.title || "");
  const focus = entityId != null && String(entityId).trim() !== "" ? String(entityId) : null;

  if (type === "check_in" || entityType === "queue") {
    return {
      path: focus ? `/staff/queue?focus=${encodeURIComponent(focus)}` : "/staff/queue",
      label: "View queue",
    };
  }

  if (type === "appointment" || entityType === "appointment") {
    const params = new URLSearchParams();
    if (/cancel/i.test(type) || /cancel/i.test(title)) {
      params.set("section", "cancelled");
    } else if (/request|booking/i.test(title) || /pending/i.test(title)) {
      params.set("section", "pending");
    }
    if (focus) params.set("focus", focus);
    const query = params.toString();
    return {
      path: query ? `/staff/appointments?${query}` : "/staff/appointments",
      label: "View appointment",
    };
  }

  if (type === "patient" || entityType === "patient") {
    return {
      path: focus ? `/staff/patients?focus=${encodeURIComponent(focus)}` : "/staff/patients",
      label: "View patient",
    };
  }

  if (type === "document" || entityType === "document") {
    return {
      path: "/staff/appointments",
      label: "View appointments",
    };
  }

  return null;
}

export function matchesNotificationFocus(item, focus) {
  if (!item || focus == null || String(focus).trim() === "") return false;
  const needle = String(focus).trim().toLowerCase().replace(/^#/, "");
  return [item.id, item.token, item.queueNumber, item.patientId].some(
    (value) => value != null && String(value).trim().toLowerCase().replace(/^#/, "") === needle
  );
}

export function getPatientNotificationTarget(notification) {
  if (!notification) return null;
  const type = String(notification.type || "").toLowerCase();
  if (type === "queue" || type === "check_in") {
    return { path: "/queue", label: "View queue" };
  }
  if (type === "document") {
    return { path: "/records", label: "View records" };
  }
  if (type === "appointment") {
    return { path: "/appointments", label: "View appointments" };
  }
  return { path: "/dashboard", label: "Open dashboard" };
}
