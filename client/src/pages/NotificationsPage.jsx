import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck, CalendarDays, Info, UsersRound } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { notifyNotificationsChanged } from "../notificationEvents";

const icons = {
  appointment: CalendarDays,
  queue: UsersRound,
};

function displayTime(value) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function NotificationsPage() {
  const [notifications, setNotifications] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async ({ markSeen = false } = {}) => {
    setError("");
    try {
      const response = await api.getNotifications();
      const items = response.notifications || [];
      setNotifications(items);

      if (markSeen) {
        const unread = items.filter((item) => !item.read);
        if (unread.length) {
          await Promise.all(
            unread.map((item) => api.markNotificationRead(item.id).catch(() => null))
          );
          setNotifications((current) =>
            (current || []).map((notification) => ({ ...notification, read: true }))
          );
        }
        notifyNotificationsChanged({ source: "patient", unread: 0 });
      }
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load({ markSeen: true });
  }, [load]);

  async function markRead(notificationId) {
    try {
      await api.markNotificationRead(notificationId);
      setNotifications((current) => {
        const next = current.map((notification) =>
          notification.id === notificationId ? { ...notification, read: true } : notification
        );
        const unread = next.filter((item) => !item.read).length;
        notifyNotificationsChanged({ source: "patient", unread });
        return next;
      });
    } catch (markError) {
      setError(markError.message);
    }
  }

  if (error && !notifications) return <ErrorState message={error} onRetry={load} />;
  if (!notifications) return <LoadingState label="Loading care updates" />;

  return (
    <div className="notifications-page">
      <SectionHeading
        eyebrow="Care updates, when they matter"
        title="Notifications"
        detail="Appointment confirmations and portal updates appear here."
      />
      {error && <p className="inline-alert inline-alert--error">{error}</p>}
      {notifications.length ? (
        <section className="notification-list glass-card">
          {notifications.map((notification) => {
            const Icon = icons[notification.type] || Info;
            return (
              <article
                className={`notification-row ${notification.read ? "" : "is-unread"}`}
                key={notification.id}
              >
                <span className="notification-row__icon"><Icon size={19} /></span>
                <div>
                  <h2>{notification.title}</h2>
                  <p>{notification.body}</p>
                  <small>{displayTime(notification.createdAt)}</small>
                </div>
                {!notification.read && (
                  <button className="button button--secondary" onClick={() => markRead(notification.id)}>
                    <CheckCheck size={16} /> Mark read
                  </button>
                )}
              </article>
            );
          })}
        </section>
      ) : (
        <EmptyState
          title="You’re all caught up"
          detail="New appointment and care updates will arrive here."
          action={<span className="empty-state__icon"><Bell size={22} /></span>}
        />
      )}
    </div>
  );
}
