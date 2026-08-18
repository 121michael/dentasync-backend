import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  CalendarDays,
  CheckCheck,
  ClipboardCheck,
  FileText,
  Info,
  RefreshCw,
  UserPlus,
} from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { formatStaffDateTime } from "../components/StaffUI";

const notificationIcons = {
  appointment: CalendarDays,
  check_in: ClipboardCheck,
  document: FileText,
  patient: UserPlus,
};

export function StaffNotificationsPage() {
  const [notifications, setNotifications] = useState(null);
  const [error, setError] = useState("");
  const [isMarkingAll, setIsMarkingAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await api.getStaffNotifications();
      setNotifications(response.notifications);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
    const refresh = window.setInterval(load, 30000);
    return () => window.clearInterval(refresh);
  }, [load]);

  async function markRead(notificationId) {
    setError("");
    try {
      await api.markStaffNotificationRead(notificationId);
      setNotifications((current) =>
        current.map((notification) =>
          notification.id === notificationId ? { ...notification, read: true } : notification
        )
      );
    } catch (markError) {
      setError(markError.message);
    }
  }

  async function markAllRead() {
    setIsMarkingAll(true);
    setError("");
    try {
      await api.markAllStaffNotificationsRead();
      setNotifications((current) => current.map((notification) => ({ ...notification, read: true })));
    } catch (markError) {
      setError(markError.message);
    } finally {
      setIsMarkingAll(false);
    }
  }

  if (error && !notifications) return <ErrorState message={error} onRetry={load} />;
  if (!notifications) return <LoadingState label="Loading staff notifications…" />;

  const unreadCount = notifications.filter((notification) => !notification.read).length;

  return (
    <div className="staff-page">
      <SectionHeading
        eyebrow="Clinic activity"
        title="Notifications"
        detail={`${unreadCount} unread ${unreadCount === 1 ? "notification" : "notifications"}`}
        action={
          <div className="staff-heading-actions">
            <button className="button button--secondary" onClick={load}>
              <RefreshCw size={16} /> Refresh
            </button>
            <button className="button button--primary" onClick={markAllRead} disabled={!unreadCount || isMarkingAll}>
              <CheckCheck size={16} /> {isMarkingAll ? "Updating…" : "Mark all as read"}
            </button>
          </div>
        }
      />

      {error && <p className="inline-alert inline-alert--error">{error}</p>}

      {notifications.length ? (
        <section className="staff-notification-list">
          {notifications.map((notification) => {
            const Icon = notificationIcons[notification.type] || Info;
            return (
              <article className={`staff-notification ${notification.read ? "" : "is-unread"}`} key={notification.id}>
                <span className="staff-notification__icon"><Icon size={20} /></span>
                <div className="staff-notification__body">
                  <div>
                    <h2>{notification.title}</h2>
                    {!notification.read && <span className="staff-unread-dot" aria-label="Unread notification" />}
                  </div>
                  <p>{notification.body}</p>
                  <small>{formatStaffDateTime(notification.createdAt)}</small>
                </div>
                {!notification.read && (
                  <button className="button button--secondary button--compact" onClick={() => markRead(notification.id)}>
                    <CheckCheck size={15} /> Mark read
                  </button>
                )}
              </article>
            );
          })}
        </section>
      ) : (
        <EmptyState
          title="You’re all caught up"
          detail="New patient, appointment, check-in, and document activity will appear here."
          action={<span className="empty-state__icon"><Bell size={22} /></span>}
        />
      )}
    </div>
  );
}
