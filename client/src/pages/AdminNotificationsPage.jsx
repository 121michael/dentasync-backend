import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck, Info, RefreshCw } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { formatAdminDateTime } from "../adminUtils";

export function AdminNotificationsPage() {
  const [notifications, setNotifications] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await api.getAdminNotifications();
      setNotifications(response.notifications);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 30000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function markAll() {
    setBusy(true);
    try {
      await api.markAllAdminNotificationsRead();
      setNotifications((current) => current.map((item) => ({ ...item, read: true })));
    } catch (markError) {
      setError(markError.message);
    } finally {
      setBusy(false);
    }
  }

  async function markOne(id) {
    try {
      await api.markAdminNotificationRead(id);
      setNotifications((current) => current.map((item) => (item.id === id ? { ...item, read: true } : item)));
    } catch (markError) {
      setError(markError.message);
    }
  }

  if (error && !notifications) return <ErrorState message={error} onRetry={load} />;
  if (!notifications) return <LoadingState label="Loading admin notifications…" />;

  const unread = notifications.filter((item) => !item.read).length;

  return (
    <div className="admin-page">
      <SectionHeading
        eyebrow="Operations feed"
        title="Notifications"
        detail={`${unread} unread ${unread === 1 ? "alert" : "alerts"}`}
        action={
          <div className="admin-heading-actions">
            <button className="button button--secondary" onClick={load}><RefreshCw size={16} /> Refresh</button>
            <button className="button button--primary" onClick={markAll} disabled={!unread || busy}><CheckCheck size={16} /> Mark All as Read</button>
          </div>
        }
      />
      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}

      {notifications.length ? (
        <section className="admin-notification-list">
          {notifications.map((notification) => (
            <article className={`admin-notification ${notification.read ? "" : "is-unread"}`} key={notification.id}>
              <span className="admin-notification__icon"><Info size={18} /></span>
              <div>
                <h2>{notification.title}</h2>
                <p>{notification.body}</p>
                <small>{formatAdminDateTime(notification.createdAt)}</small>
              </div>
              {!notification.read ? (
                <button className="button button--secondary button--compact" onClick={() => markOne(notification.id)}>Mark read</button>
              ) : null}
            </article>
          ))}
        </section>
      ) : (
        <EmptyState title="You’re all caught up" detail="Clinic alerts and account activity will appear here." action={<span className="empty-state__icon"><Bell size={22} /></span>} />
      )}
    </div>
  );
}
