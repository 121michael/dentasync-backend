import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck, CalendarDays, ExternalLink, Info, UsersRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { notifyNotificationsChanged } from "../notificationEvents";
import { getPatientNotificationTarget } from "../patientNotificationNav";

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
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const publishUnread = useCallback((count) => {
    const unread = Number(count) || 0;
    setUnreadCount(unread);
    notifyNotificationsChanged({ source: "patient", unread });
  }, []);

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await api.getNotifications();
      const items = response.notifications || [];
      setNotifications(items);
      const unread = Number.isFinite(Number(response.unreadCount))
        ? Number(response.unreadCount)
        : items.filter((item) => !item.read).length;
      publishUnread(unread);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [publishUnread]);

  useEffect(() => {
    load();
  }, [load]);

  async function markRead(notificationId) {
    try {
      await api.markNotificationRead(notificationId);
      setNotifications((current) =>
        current.map((notification) =>
          notification.id === notificationId ? { ...notification, read: true } : notification
        )
      );
      publishUnread(Math.max(0, unreadCount - 1));
    } catch (markError) {
      setError(markError.message);
    }
  }

  async function handleNotificationClick(notification) {
    const target = getPatientNotificationTarget(notification);
    if (!notification.read) {
      try {
        await api.markNotificationRead(notification.id);
        setNotifications((current) =>
          (current || []).map((item) =>
            item.id === notification.id ? { ...item, read: true } : item
          )
        );
        publishUnread(Math.max(0, unreadCount - 1));
      } catch (markError) {
        setError(markError.message);
      }
    }
    if (target?.path) navigate(target.path);
  }

  async function markAll() {
    setBusy(true);
    setError("");
    try {
      await api.markAllNotificationsRead();
      setNotifications((current) => (current || []).map((notification) => ({ ...notification, read: true })));
      publishUnread(0);
    } catch (markError) {
      setError(markError.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !notifications) return <ErrorState message={error} onRetry={load} />;
  if (!notifications) return <LoadingState label="Loading care updates" />;

  return (
    <div className="notifications-page">
      <SectionHeading
        eyebrow="Care updates, when they matter"
        title="Notifications"
        detail={`${unreadCount} unread ${unreadCount === 1 ? "update" : "updates"}`}
        action={
          <button type="button" className="button button--primary" onClick={markAll} disabled={!unreadCount || busy}>
            <CheckCheck size={16} /> Mark all as read
          </button>
        }
      />
      {error && <p className="inline-alert inline-alert--error">{error}</p>}
      {notifications.length ? (
        <section className="notification-list glass-card">
          {notifications.map((notification) => {
            const Icon = icons[notification.type] || Info;
            const target = getPatientNotificationTarget(notification);
            const clickable = Boolean(target?.path);
            return (
              <article
                className={`notification-row ${notification.read ? "" : "is-unread"} ${
                  clickable ? "is-clickable" : ""
                }`}
                key={notification.id}
                role={clickable ? "button" : undefined}
                tabIndex={clickable ? 0 : undefined}
                onClick={() => {
                  if (clickable) handleNotificationClick(notification);
                }}
                onKeyDown={(event) => {
                  if (!clickable) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    handleNotificationClick(notification);
                  }
                }}
              >
                <span className="notification-row__icon"><Icon size={19} /></span>
                <div>
                  <h2>{notification.title}</h2>
                  <p>{notification.body}</p>
                  <small>{displayTime(notification.createdAt)}</small>
                </div>
                <div className="notification-row__aside" onClick={(event) => event.stopPropagation()}>
                  {clickable ? (
                    <button
                      type="button"
                      className="button button--primary button--compact"
                      onClick={() => handleNotificationClick(notification)}
                    >
                      <ExternalLink size={16} /> {target.label || "View"}
                    </button>
                  ) : null}
                  {!notification.read ? (
                    <button className="button button--secondary" onClick={() => markRead(notification.id)}>
                      <CheckCheck size={16} /> Mark read
                    </button>
                  ) : null}
                </div>
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
