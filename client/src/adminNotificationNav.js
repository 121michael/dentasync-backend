/**
 * Resolve where an admin notification should navigate when clicked.
 * Uses structured type/entity fields — not message text.
 */
export function getAdminNotificationTarget(notification) {
  if (!notification) return null;

  const type = String(notification.type || "").toLowerCase();
  const entityType = String(notification.entityType || notification.entity_type || "").toLowerCase();
  const entityId = notification.entityId ?? notification.entity_id ?? null;
  const title = String(notification.title || "");
  const focus = entityId != null && String(entityId).trim() !== "" ? String(entityId) : null;

  if (type === "staff" || entityType === "staff") {
    const params = new URLSearchParams({ tab: "staff" });
    if (focus) params.set("focus", focus);
    return {
      targetPage: "users",
      path: `/admin/users?${params}`,
      label: "View staff account",
    };
  }

  if (type === "dentist" || entityType === "dentist") {
    const params = new URLSearchParams({ tab: "dentist" });
    if (focus) params.set("focus", focus);
    return {
      targetPage: "users",
      path: `/admin/users?${params}`,
      label: "View dentist account",
    };
  }

  if (
    type === "patient" ||
    entityType === "patient" ||
    entityType === "clinical_patient"
  ) {
    return {
      targetPage: "patient-records",
      path: focus
        ? `/admin/patient-records?focus=${encodeURIComponent(focus)}`
        : "/admin/patient-records",
      label: "View patient",
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
      params.set("status", "cancelled");
    }
    if (focus) params.set("focus", focus);
    const query = params.toString();
    return {
      targetPage: "schedule",
      path: query ? `/admin/schedule?${query}` : "/admin/schedule",
      label: "View appointment",
    };
  }

  if (type === "document" || entityType === "document") {
    return {
      targetPage: "sync-data",
      path: focus ? `/admin/sync-data?focus=${encodeURIComponent(focus)}` : "/admin/sync-data",
      label: "View document sync",
    };
  }

  if (type === "check_in" || entityType === "queue") {
    return {
      targetPage: "schedule",
      path: focus ? `/admin/schedule?focus=${encodeURIComponent(focus)}` : "/admin/schedule",
      label: "View clinic activity",
    };
  }

  return null;
}
