/** Tiny browser event bus so layouts refresh alert dots immediately. */

export const NOTIFICATIONS_CHANGED_EVENT = "amethyst:notifications-changed";

export function notifyNotificationsChanged(detail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(NOTIFICATIONS_CHANGED_EVENT, { detail }));
}

export function onNotificationsChanged(handler) {
  if (typeof window === "undefined") {
    return () => {};
  }
  const listener = (event) => handler(event.detail || {});
  window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, listener);
  return () => window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, listener);
}
