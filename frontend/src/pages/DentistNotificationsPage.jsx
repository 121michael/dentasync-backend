import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck, ExternalLink, Info, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { formatDentistDateTime } from "../dentistUtils";
import { notifyNotificationsChanged } from "../notificationEvents";
import { getDentistNotificationTarget } from "../dentistNotificationNav";

export function DentistNotificationsPage() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async ({ markSeen = false } = {}) => {
    try {
      const response = await api.getDentistNotifications();
      const items = response.notifications || [];
      setNotifications(items);
      setError("");

      if (markSeen) {
        const unread = items.filter((item) => !item.read);
        if (unread.length) {
          await api.markAllDentistNotificationsRead();
          setNotifications((current) =>
            (current || []).map((item) => ({ ...item, read: true }))
          );
        }
        notifyNotificationsChanged({ source: "dentist", unread: 0 });
      }
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load({ markSeen: true });
    const timer = window.setInterval(() => load({ markSeen: false }), 20000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function markAll() {
    setBusy(true);
    try {
      await api.markAllDentistNotificationsRead();
      setNotifications((current) => (current || []).map((item) => ({ ...item, read: true })));
      notifyNotificationsChanged({ source: "dentist", unread: 0 });
    } catch (markError) {
      setError(markError.message);
    } finally {
      setBusy(false);
    }
  }

  async function markOne(id) {
    try {
      await api.markDentistNotificationRead(id);
      setNotifications((current) => {
        const next = (current || []).map((item) => (item.id === id ? { ...item, read: true } : item));
        notifyNotificationsChanged({
          source: "dentist",
          unread: next.filter((item) => !item.read).length,
        });
        return next;
      });
    } catch (markError) {
      setError(markError.message);
    }
  }

  async function handleNotificationClick(notification) {
    const target = getDentistNotificationTarget(notification);
    if (!notification.read) {
      try {
        await api.markDentistNotificationRead(notification.id);
        setNotifications((current) =>
          (current || []).map((item) =>
            item.id === notification.id ? { ...item, read: true } : item
          )
        );
        notifyNotificationsChanged({ source: "dentist" });
      } catch (markError) {
        setError(markError.message);
      }
    }

    if (!target?.path) {
      setError("This notification has no linked record yet.");
      return;
    }

    navigate(target.path);
  }

  if (error && !notifications) return <ErrorState message={error} onRetry={() => load({ markSeen: true })} />;
  if (!notifications) return <LoadingState label="Loading dentist notifications…" />;

  const unread = notifications.filter((item) => !item.read).length;

  return (
    <div className="dentist-page">
      <SectionHeading
        eyebrow="Chairside alerts"
        title="Notifications"
        detail={`${unread} unread ${unread === 1 ? "alert" : "alerts"}`}
        action={
          <div className="dentist-heading-actions">
            <button type="button" className="button button--secondary" onClick={() => load({ markSeen: false })}>
              <RefreshCw size={16} /> Refresh
            </button>
            <button type="button" className="button button--primary" onClick={markAll} disabled={!unread || busy}>
              <CheckCheck size={16} /> Mark all read
            </button>
          </div>
        }
      />
      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}

      {notifications.length ? (
        <section className="dentist-notification-list">
          {notifications.map((notification) => {
            const target = getDentistNotificationTarget(notification);
            const clickable = Boolean(target?.path);
            return (
              <article
                key={notification.id}
                role={clickable ? "button" : undefined}
                tabIndex={clickable ? 0 : undefined}
                className={`dentist-notification ${notification.read ? "" : "is-unread"} ${
                  clickable ? "is-clickable" : ""
                }`}
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
                <span className="dentist-notification__icon"><Info size={18} /></span>
                <div>
                  <h2>{notification.title}</h2>
                  <p>{notification.body}</p>
                  <small>{formatDentistDateTime(notification.createdAt)}</small>
                </div>
                <div className="dentist-notification__aside" onClick={(event) => event.stopPropagation()}>
                  {clickable ? (
                    <button
                      type="button"
                      className="button button--primary button--compact"
                      onClick={() => handleNotificationClick(notification)}
                    >
                      <ExternalLink size={14} /> {target.label || "View"}
                    </button>
                  ) : null}
                  {!notification.read ? (
                    <button
                      type="button"
                      className="button button--secondary button--compact"
                      onClick={() => markOne(notification.id)}
                    >
                      Mark read
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </section>
      ) : (
        <EmptyState
          title="No notifications yet"
          detail="Appointment requests and check-ins assigned to you will appear here."
          action={<span className="empty-state__icon"><Bell size={22} /></span>}
        />
      )}
    </div>
  );
}
