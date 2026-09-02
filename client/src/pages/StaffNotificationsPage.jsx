import { useCallback, useEffect, useState } from "react";
import { CheckCheck, MessageSquare, RefreshCw } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { StaffModal, StaffStatusBadge } from "../components/StaffUI";
import { useStaffUi } from "../components/StaffLayout";
import { formatStaffDateTime } from "../staffUtils";
import { notifyNotificationsChanged } from "../notificationEvents";

export function StaffNotificationsPage() {
  const { pushToast } = useStaffUi();
  const [notifications, setNotifications] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [smsOpen, setSmsOpen] = useState(false);
  const [smsForm, setSmsForm] = useState({
    phone: "",
    message: "",
    messageType: "manual",
    patientUserId: "",
  });

  const load = useCallback(async ({ markSeen = false } = {}) => {
    try {
      const response = await api.getStaffNotifications();
      const items = response.notifications || [];
      setNotifications(items);
      setError("");

      if (markSeen) {
        const unread = items.filter((item) => !item.read);
        if (unread.length) {
          await api.markAllStaffNotificationsRead();
          setNotifications((current) =>
            (current || []).map((notification) => ({ ...notification, read: true }))
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
      await load({ markSeen: false });
      notifyNotificationsChanged({ source: "staff" });
    } catch (markError) {
      pushToast(markError.message, "error");
    } finally {
      setBusy("");
    }
  }

  async function markAll() {
    setBusy("all");
    try {
      await api.markAllStaffNotificationsRead();
      pushToast("All notifications marked as read.");
      await load({ markSeen: false });
      notifyNotificationsChanged({ source: "staff", unread: 0 });
    } catch (markError) {
      pushToast(markError.message, "error");
    } finally {
      setBusy("");
    }
  }

  async function sendSms(event) {
    event.preventDefault();
    setBusy("sms");
    try {
      const response = await api.sendStaffSms(smsForm);
      pushToast(response.message || "Notification sent successfully.");
      setSmsOpen(false);
      setSmsForm({ phone: "", message: "", messageType: "manual", patientUserId: "" });
    } catch (smsError) {
      pushToast(smsError.message, "error");
    } finally {
      setBusy("");
    }
  }

  if (error && !notifications) return <ErrorState message={error} onRetry={load} />;
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
            <button className="button button--secondary" onClick={load}>
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
            {notifications.map((notification) => (
              <article
                key={notification.id}
                className={`staff-notification-card ${notification.read ? "" : "is-unread"}`}
              >
                <div>
                  <div className="staff-notification-card__meta">
                    <StaffStatusBadge status={notification.type || "system"} />
                    <small>{formatStaffDateTime(notification.createdAt)}</small>
                  </div>
                  <h3>{notification.title}</h3>
                  <p>{notification.body}</p>
                </div>
                {!notification.read ? (
                  <button
                    className="button button--secondary button--compact"
                    disabled={Boolean(busy)}
                    onClick={() => markRead(notification.id)}
                  >
                    Mark read
                  </button>
                ) : (
                  <span className="muted-copy">Read</span>
                )}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="No notifications" detail="Clinic alerts and SMS events will appear here." />
        )}
      </section>

      {smsOpen ? (
        <StaffModal title="Send / override SMS notification" onClose={() => setSmsOpen(false)}>
          <form className="admin-form" onSubmit={sendSms}>
            <label className="field">
              <span>Patient phone</span>
              <input
                required
                value={smsForm.phone}
                onChange={(event) => setSmsForm((current) => ({ ...current, phone: event.target.value }))}
                placeholder="09xxxxxxxxx"
              />
            </label>
            <label className="field">
              <span>Message type</span>
              <select
                value={smsForm.messageType}
                onChange={(event) => setSmsForm((current) => ({ ...current, messageType: event.target.value }))}
              >
                <option value="manual">Manual override</option>
                <option value="appointment_confirmed">Appointment Confirmed</option>
                <option value="appointment_rescheduled">Appointment Rescheduled</option>
                <option value="appointment_cancelled">Appointment Cancelled</option>
                <option value="queue_updated">Queue Updated</option>
              </select>
            </label>
            <label className="field">
              <span>Message</span>
              <textarea
                required
                rows="4"
                value={smsForm.message}
                onChange={(event) => setSmsForm((current) => ({ ...current, message: event.target.value }))}
                placeholder="Queue Updated – Your Current Position: #3"
              />
            </label>
            <button className="button button--primary" disabled={Boolean(busy)}>
              {busy === "sms" ? "Sending…" : "Send notification"}
            </button>
          </form>
        </StaffModal>
      ) : null}
    </div>
  );
}
