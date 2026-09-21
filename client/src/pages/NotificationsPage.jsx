import { useCallback, useEffect, useState } from "react";
import { Bell, CalendarDays, Info, UsersRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { notifyNotificationsChanged, onNotificationsChanged } from "../notificationEvents";
import { getPatientNotificationTarget } from "../staffNotificationNav";

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
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await api.getNotifications();
      setNotifications(response.notifications);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
    const stopListening = onNotificationsChanged((detail) => {
      if (detail?.source === "patient" && detail.unread === 0) {
        setNotifications((current) =>
          current ? current.map((notification) => ({ ...notification, read: true })) : current
        );
      }
    });
    return stopListening;
  }, [load]);

  async function openNotification(notification) {
    if (!notification.read) {
      try {
        await api.markNotificationRead(notification.id);
        setNotifications((current) =>
          current.map((item) => (item.id === notification.id ? { ...item, read: true } : item))
        );
        notifyNotificationsChanged({ source: "patient" });
      } catch (markError) {
        setError(markError.message);
      }
    }
    const target = getPatientNotificationTarget(notification);
    if (target?.path) {
      navigate(target.path);
    }
  }

  if (error && !notifications) return <ErrorState message={error} onRetry={load} />;
  if (!notifications) return <LoadingState label="Loading care updates" />;

  return (
    <div className="notifications-page">
      <SectionHeading
        eyebrow="Care updates, when they matter"
        title="Notifications"
        detail="Tap a notification to open the related appointment, queue, or record."
      />
      {error && <p className="inline-alert inline-alert--error">{error}</p>}
      {notifications.length ? (
        <section className="notification-list glass-card">
          {notifications.map((notification) => {
            const Icon = icons[notification.type] || Info;
            const target = getPatientNotificationTarget(notification);
            return (
              <article
                className={`notification-row ${notification.read ? "" : "is-unread"} is-clickable`}
                key={notification.id}
                role="link"
                tabIndex={0}
                onClick={() => openNotification(notification)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openNotification(notification);
                  }
                }}
              >
                <span className="notification-row__icon"><Icon size={19} /></span>
                <div>
                  <h2>{notification.title}</h2>
                  <p>{notification.body}</p>
                  <small>{displayTime(notification.createdAt)}</small>
                </div>
                <span className="notification-row__action">{target?.label || "Open"}</span>
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
