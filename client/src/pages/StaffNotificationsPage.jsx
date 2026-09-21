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
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { formatStaffDateTime } from "../staffUtils";
import { notifyNotificationsChanged, onNotificationsChanged } from "../notificationEvents";
import { getStaffNotificationTarget } from "../staffNotificationNav";

const notificationIcons = {
  appointment: CalendarDays,
  check_in: ClipboardCheck,
  document: FileText,
  patient: UserPlus,
};

export function StaffNotificationsPage() {
  const navigate = useNavigate();
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
    const stopListening = onNotificationsChanged((detail) => {
      if (detail?.source === "staff" && detail.unread === 0) {
        setNotifications((current) =>
          current ? current.map((notification) => ({ ...notification, read: true })) : current
        );
      }
    });
    return () => {
      window.clearInterval(refresh);
      stopListening();
    };
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
      notifyNotificationsChanged({ source: "staff" });
    } catch (markError) {
      setError(markError.message);
    }
  }

  async function openNotification(notification) {
    if (!notification.read) {
      await markRead(notification.id);
    }
    const target = getStaffNotificationTarget(notification);
    if (target?.path) {
      navigate(target.path);
    }
  }

  async function markAllRead() {
    setIsMarkingAll(true);
    setError("");
    try {
      await api.markAllStaffNotificationsRead();
      setNotifications((current) => current.map((notification) => ({ ...notification, read: true })));
      notifyNotificationsChanged({ source: "staff", unread: 0 });
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
            const target = getStaffNotificationTarget(notification);
            return (
              <article
                className={`staff-notification ${notification.read ? "" : "is-unread"} ${target ? "is-clickable" : ""}`}
                key={notification.id}
                role={target ? "link" : undefined}
                tabIndex={target ? 0 : undefined}
                onClick={() => openNotification(notification)}
                onKeyDown={(event) => {
                  if (!target) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openNotification(notification);
                  }
                }}
              >
                <span className="staff-notification__icon"><Icon size={20} /></span>
                <div className="staff-notification__body">
                  <div>
                    <h2>{notification.title}</h2>
                    {!notification.read && <span className="staff-unread-dot" aria-label="Unread notification" />}
                  </div>
                  <p>{notification.body}</p>
                  <small>{formatStaffDateTime(notification.createdAt)}</small>
                </div>
                {target ? (
                  <span className="staff-notification__action">{target.label}</span>
                ) : !notification.read ? (
                  <button
                    className="button button--secondary button--compact"
                    onClick={(event) => {
                      event.stopPropagation();
                      markRead(notification.id);
                    }}
                  >
                    <CheckCheck size={15} /> Mark read
                  </button>
                ) : null}
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
