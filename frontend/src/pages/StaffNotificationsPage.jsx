import { useCallback, useEffect, useState } from "react";
import { CheckCheck, ExternalLink, MessageSquare, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { StaffStatusBadge } from "../components/StaffUI";
import { SendSmsModal } from "../components/SendSmsModal";
import { useStaffUi } from "../components/StaffLayout";
import { formatStaffDateTime } from "../staffUtils";
import { notifyNotificationsChanged } from "../notificationEvents";
import { getStaffNotificationTarget } from "../staffNotificationNav";

export function StaffNotificationsPage() {
  const navigate = useNavigate();
  const { pushToast } = useStaffUi();
  const [notifications, setNotifications] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [smsOpen, setSmsOpen] = useState(false);
  const [smsLogs, setSmsLogs] = useState([]);
  const [appointments, setAppointments] = useState([]);

  const load = useCallback(async ({ markSeen = false } = {}) => {
    try {
      const [response, logsResponse, today, confirmed] = await Promise.all([
        api.getStaffNotifications(),
        api.getStaffSmsLogs({ limit: 20 }).catch(() => ({ logs: [] })),
        api.getStaffAppointments("today").catch(() => ({ appointments: [] })),
        api.getStaffAppointments("confirmed").catch(() => ({ appointments: [] })),
      ]);
      const items = response.notifications || [];
      setNotifications(items);
      setSmsLogs(logsResponse.logs || []);
      setAppointments([...(today.appointments || []), ...(confirmed.appointments || [])]);
      setError("");
      if (markSeen) {
        const unread = items.filter((item) => !item.read);
        if (unread.length) {
          await api.markAllStaffNotificationsRead();
          setNotifications((current) =>
            (current || []).map((item) => ({ ...item, read: true }))
          );
        }
        notifyNotificationsChanged({ source: "staff", unread: 0 });
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

  async function markRead(notificationId) {
    setBusy(`read-${notificationId}`);
    try {
      await api.markStaffNotificationRead(notificationId);
      setNotifications((current) =>
        (current || []).map((notification) =>
          notification.id === notificationId ? { ...notification, read: true } : notification
        )
      );
      notifyNotificationsChanged({ source: "staff" });
    } catch (markError) {
      pushToast(markError.message, "error");
    } finally {
      setBusy("");
    }
  }

  async function handleNotificationClick(notification) {
    const target = getStaffNotificationTarget(notification);
    if (!notification.read) {
      try {
        await api.markStaffNotificationRead(notification.id);
        setNotifications((current) =>
          (current || []).map((item) =>
            item.id === notification.id ? { ...item, read: true } : item
          )
        );
        notifyNotificationsChanged({ source: "staff" });
      } catch (markError) {
        pushToast(markError.message, "error");
      }
    }

    if (!target?.path) {
      pushToast("This notification has no linked record yet.", "error");
      return;
    }

    navigate(target.path);
  }

  async function markAll() {
    setBusy("all");
    try {
      await api.markAllStaffNotificationsRead();
      pushToast("All notifications marked as read.");
      await load();
      notifyNotificationsChanged({ source: "staff", unread: 0 });
    } catch (markError) {
      pushToast(markError.message, "error");
    } finally {
      setBusy("");
    }
  }

  if (error && !notifications) return <ErrorState message={error} onRetry={() => load({ markSeen: false })} />;
  if (!notifications) return <LoadingState label="Loading notification center…" />;

  return (
    <div className="staff-page">
      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}

      <section className="staff-panel">
        <div className="staff-panel__heading">
          <div>
            <span className="eyebrow">Operations alerts</span>
            <h2>Notification Center</h2>
            <p>Track appointment requests, check-ins, queue updates, and SMS delivery status.</p>
          </div>
          <div className="staff-heading-actions">
            <button className="button button--secondary" onClick={() => load({ markSeen: false })}>
              <RefreshCw size={16} /> Refresh
            </button>
            <button className="button button--secondary" onClick={markAll} disabled={Boolean(busy)}>
              <CheckCheck size={16} /> Mark all read
            </button>
            <button className="button button--primary" onClick={() => setSmsOpen(true)}>
              <MessageSquare size={16} /> Send SMS
            </button>
          </div>
        </div>

        {notifications.length ? (
          <div className="staff-notification-list">
            {notifications.map((notification) => {
              const target = getStaffNotificationTarget(notification);
              const clickable = Boolean(target?.path);

              return (
                <article
                  key={notification.id}
                  role={clickable ? "button" : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  className={`staff-notification-card ${notification.read ? "" : "is-unread"} ${
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
                  <div>
                    <div className="staff-notification-card__meta">
                      <StaffStatusBadge status={notification.type || "system"} />
                      <small>{formatStaffDateTime(notification.createdAt)}</small>
                      {!notification.read ? <span className="staff-notification-card__dot" aria-hidden="true" /> : null}
                    </div>
                    <h3>{notification.title}</h3>
                    <p>{notification.body}</p>
                  </div>
                  <div className="staff-notification-card__aside" onClick={(event) => event.stopPropagation()}>
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
                        disabled={Boolean(busy)}
                        onClick={() => markRead(notification.id)}
                      >
                        Mark read
                      </button>
                    ) : (
                      <span className="muted-copy">Read</span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState title="No notifications" detail="Clinic alerts and SMS events will appear here." />
        )}
      </section>

      <section className="staff-panel">
        <div className="staff-panel__heading">
          <div>
            <span className="eyebrow">SMS audit</span>
            <h2>SMS history</h2>
            <p>Statuses reflect provider results. Sent means accepted by Semaphore, not a delivery receipt.</p>
          </div>
        </div>
        {smsLogs.length ? (
          <div className="sms-history">
            {smsLogs.map((log) => (
              <article key={log.id} className="sms-history-row">
                <div className="sms-history-row__meta">
                  <StaffStatusBadge status={log.status} />
                  <small>{formatStaffDateTime(log.createdAt)}</small>
                  <small>{log.origin || "automatic"}</small>
                  <small>{log.recipientMasked || "••••"}</small>
                </div>
                <strong>{String(log.messageType || "sms").replaceAll("_", " ")}</strong>
                <p>{log.messageBody}</p>
                {log.errorDetail ? <small>{log.errorDetail}</small> : null}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="No SMS logs yet" detail="Manual and automatic patient SMS will appear here after they are attempted." />
        )}
      </section>

      {smsOpen ? (
        <SendSmsModal
          appointments={appointments}
          onClose={() => setSmsOpen(false)}
          onSent={() => load({ markSeen: false })}
          pushToast={pushToast}
        />
      ) : null}
    </div>
  );
}
