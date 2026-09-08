import { useCallback, useEffect, useState } from "react";
import {
  BellRing,
  Check,
  CircleDot,
  RefreshCw,
  Ticket,
} from "lucide-react";
import { api } from "../api";
import { PatientQrCheckInScanner } from "../components/PatientQrCheckInScanner";
import { EmptyState, ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { displayQueueStatus } from "../utils/walkInQr";

export function QueuePage() {
  const [queueData, setQueueData] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [queueResponse, appointmentResponse] = await Promise.all([
        api.getQueue(),
        api.getAppointments(),
      ]);
      setQueueData(queueResponse);
      setAppointments(
        appointmentResponse.appointments.filter((appointment) =>
          ["confirmed", "checked_in", "pending"].includes(appointment.status)
        )
      );
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = window.setInterval(load, 12000);
    return () => window.clearInterval(interval);
  }, [load]);

  async function updateNotificationPreference(event) {
    const nextValue = event.target.checked;
    try {
      const response = await api.updateQueueNotifications(nextValue);
      setQueueData((current) => ({ ...current, notifyWhenNear: response.notifyWhenNear }));
    } catch (updateError) {
      setError(updateError.message);
    }
  }

  if (error && !queueData) return <ErrorState message={error} onRetry={load} />;
  if (!queueData) return <LoadingState label="Syncing your live queue" />;

  const { current, nowServing } = queueData;
  const todayAppointments = appointments.filter((appointment) => {
    const date = String(appointment.date || "").slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    return date === today || appointment.status === "checked_in";
  });

  return (
    <div className="queue-page">
      <SectionHeading
        eyebrow="Central clinic queue"
        title="Your queue status"
        detail="RFID and QR check-in both use the same clinic queue number shared with Staff and Dentist."
        action={
          <button className="button button--secondary" onClick={load}>
            <RefreshCw size={16} /> Refresh
          </button>
        }
      />

      {error && <p className="inline-alert inline-alert--error">{error}</p>}
      {success ? <p className="inline-alert inline-alert--success">{success}</p> : null}

      {current ? (
        <>
          <section className="queue-hero">
            <div>
              <span className="eyebrow eyebrow--light">Your queue</span>
              <div className="queue-hero__numbers">
                <div>
                  <small>Now serving</small>
                  <strong>{nowServing || "Preparing next patient"}</strong>
                </div>
                <div className="queue-hero__ticket">
                  <small>Your queue number</small>
                  <strong>{current.token}</strong>
                </div>
                <div>
                  <small>Status</small>
                  <strong>{displayQueueStatus(current.status)}</strong>
                </div>
              </div>
            </div>
            <div className="queue-glow-ring" aria-label={`Your ticket ${current.token}`}>
              <Ticket size={31} />
            </div>
          </section>

          <section className="glass-card queue-progress-card">
            <div className="card-heading">
              <div>
                <span className="eyebrow">Your care flow</span>
                <h2>One step at a time</h2>
              </div>
              <span className="status-pill status-pill--checked_in">{displayQueueStatus(current.status)}</span>
            </div>
            <div className="queue-stepper">
              {(current.steps || []).map((step) => (
                <div key={step.id} className={`queue-step queue-step--${step.state}`}>
                  <span>{step.state === "complete" ? <Check size={15} /> : <CircleDot size={15} />}</span>
                  <strong>{step.label}</strong>
                </div>
              ))}
            </div>
            <p className="queue-disclaimer">
              Estimated wait ~{current.estimatedWaitMinutes || 0} min. This is the same queue number Staff and
              Dentist see.
            </p>
            <label className="queue-toggle">
              <span>
                <BellRing size={18} />
                <span>
                  <strong>Notify me when it’s almost my turn</strong>
                  <small>We’ll alert you as the queue gets close.</small>
                </span>
              </span>
              <input
                type="checkbox"
                checked={queueData.notifyWhenNear}
                onChange={updateNotificationPreference}
              />
              <i aria-hidden="true" />
            </label>
          </section>
        </>
      ) : (
        <section className="queue-empty-wrap">
          <EmptyState
            title="No active queue ticket"
            detail="When you arrive, tap your RFID card or scan the clinic QR code to join the central queue."
          />

          <div className="checkin-card">
            <div>
              <span className="eyebrow">At the clinic?</span>
              <h2>Check-In</h2>
              <p>
                Ask staff for the clinic check-in QR if you do not have an RFID card. Scanning creates your
                queue number immediately.
              </p>
            </div>
            <PatientQrCheckInScanner
              onCheckedIn={(response) => {
                const number = response.queue?.queueNumber || response.queue?.token;
                setSuccess(
                  response.alreadyCheckedIn
                    ? `You are already checked in. Queue ${number}.`
                    : `Check-in successful. Your queue number is ${number}.`
                );
                load();
              }}
            />
            {todayAppointments.length ? (
              <div className="checkin-card__appointments">
                <small>Today’s appointment</small>
                {todayAppointments.map((appointment) => (
                  <p key={appointment.id}>
                    <strong>{appointment.treatment || appointment.service}</strong>
                    <span> · {String(appointment.status || "").replaceAll("_", " ")}</span>
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      )}
    </div>
  );
}
