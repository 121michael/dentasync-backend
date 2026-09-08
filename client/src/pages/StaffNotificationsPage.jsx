import { useCallback, useEffect, useState } from "react";
import { CheckCheck, ExternalLink, MessageSquare, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { StaffModal, StaffStatusBadge } from "../components/StaffUI";
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
  const [smsForm, setSmsForm] = useState({
    phone: "",
    message: "",
    messageType: "manual",
    patientUserId: "",
  });

  const load = useCallback(async () => {
    try {
      const response = await api.getStaffNotifications();
      setNotifications(response.notifications || []);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 20000);
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

  async function setActionStatus(notificationId, actionStatus) {
    setBusy(`action-${notificationId}-${actionStatus}`);
    try {
      await api.updateStaffNotificationAction(notificationId, { actionStatus, status: actionStatus });
      pushToast(`Action marked ${actionStatus.replaceAll("_", " ")}.`);
      await load();
    } catch (actionError) {
      pushToast(actionError.message, "error");
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
                      <StaffStatusBadge
                        status={notification.actionStatus || notification.action_status || "pending"}
                      />
                      <small>{formatStaffDateTime(notification.createdAt)}</small>
                      {!notification.read ? <span className="staff-notification-card__dot" aria-hidden="true" /> : null}
                    </div>
                    <h3>{notification.title}</h3>
                    <p>{notification.body}</p>
                    <div
                      className="staff-row-actions"
                      style={{ marginTop: "0.75rem" }}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      {["pending", "in_progress", "completed"].map((status) => (
                        <button
                          key={status}
                          type="button"
                          className={`button button--compact ${
                            (notification.actionStatus || notification.action_status || "pending") === status
                              ? "button--primary"
                              : "button--secondary"
                          }`}
                          disabled={Boolean(busy)}
                          onClick={() => setActionStatus(notification.id, status)}
                        >
                          {status.replaceAll("_", " ")}
                        </button>
                      ))}
                    </div>
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
