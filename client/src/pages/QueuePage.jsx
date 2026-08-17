import { useCallback, useEffect, useState } from "react";
import {
  BellRing,
  Check,
  CircleDot,
  Clock3,
  RefreshCw,
  Ticket,
  UsersRound,
} from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, SectionHeading } from "../components/UI";

function titleCase(value) {
  return value?.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Waiting";
}

export function QueuePage() {
  const [queueData, setQueueData] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [error, setError] = useState("");
  const [isCheckingIn, setIsCheckingIn] = useState(false);

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
          ["confirmed", "checked_in"].includes(appointment.status)
        )
      );
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = window.setInterval(load, 45000);
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

  async function checkIn(appointmentId) {
    setIsCheckingIn(true);
    setError("");
    try {
      await api.checkIn(appointmentId);
      await load();
    } catch (checkInError) {
      setError(checkInError.message);
    } finally {
      setIsCheckingIn(false);
    }
  }

  if (error && !queueData) return <ErrorState message={error} onRetry={load} />;
  if (!queueData) return <LoadingState label="Syncing your live queue" />;

  const { current, nowServing, queue } = queueData;

  return (
    <div className="queue-page">
      <SectionHeading
        eyebrow="Transparent, calming care"
        title="Live queue progress"
        detail="Your estimated wait updates as the clinic moves through each care moment."
        action={
          <button className="button button--secondary" onClick={load}>
            <RefreshCw size={16} /> Refresh
          </button>
        }
      />

      {error && <p className="inline-alert inline-alert--error">{error}</p>}

      {current ? (
        <>
          <section className="queue-hero">
            <div>
              <span className="eyebrow eyebrow--light">Live queue progress</span>
              <div className="queue-hero__numbers">
                <div>
                  <small>Now serving</small>
                  <strong>{nowServing || "Preparing next patient"}</strong>
                </div>
                <div className="queue-hero__ticket">
                  <small>Your ticket</small>
                  <strong>{current.token}</strong>
                </div>
                <div>
                  <small>Estimated wait</small>
                  <strong>~{current.estimatedWaitMinutes} min</strong>
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
              <span className="status-pill status-pill--checked_in">{titleCase(current.status)}</span>
            </div>
            <div className="queue-stepper">
              {current.steps.map((step) => (
                <div key={step.id} className={`queue-step queue-step--${step.state}`}>
                  <span>{step.state === "complete" ? <Check size={15} /> : <CircleDot size={15} />}</span>
                  <strong>{step.label}</strong>
                </div>
              ))}
            </div>
            <div className="care-timeline">
              {current.steps.map((step) => (
                <div key={step.id} className={`timeline-item timeline-item--${step.state}`}>
                  <span>{step.state === "complete" ? <Check size={14} /> : <CircleDot size={14} />}</span>
                  <div>
                    <strong>{step.label}</strong>
                    <small>
                      {step.state === "complete"
                        ? "Completed"
                        : step.state === "current"
                          ? "Current stage"
                          : "Upcoming"}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="glass-card queue-list-card">
            <div className="card-heading">
              <div>
                <span className="eyebrow">Today at Amethyst</span>
                <h2>Live queue</h2>
              </div>
              <span className="live-indicator"><i /> Live</span>
            </div>
            <div className="queue-table">
              <div className="queue-table__header">
                <span>Token</span>
                <span>Status</span>
                <span>Estimated time</span>
              </div>
              {queue.map((entry) => (
                <div
                  key={entry.token}
                  className={`queue-table__row ${entry.isCurrentPatient ? "is-you" : ""}`}
                >
                  <strong>{entry.token} {entry.isCurrentPatient ? <em>You</em> : null}</strong>
                  <span>{titleCase(entry.status)}</span>
                  <span>{entry.status === "completed" ? "Completed" : `~${entry.estimatedWaitMinutes} min`}</span>
                </div>
              ))}
            </div>
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
            <p className="queue-disclaimer">
              Estimated waiting times may change depending on treatment duration.
            </p>
          </section>
        </>
      ) : (
        <section className="queue-empty-wrap">
          <EmptyState
            title="No active queue ticket"
            detail="Check in when you arrive for a confirmed appointment to see real-time queue progress."
          />
          {appointments.length > 0 && (
            <div className="checkin-card">
              <div>
                <span className="eyebrow">At the clinic?</span>
                <h2>Check in for your visit</h2>
                <p>We’ll create your queue token and keep you updated here.</p>
              </div>
              <div className="checkin-card__actions">
                {appointments.map((appointment) => (
                  <button
                    key={appointment.id}
                    className="button button--primary"
                    onClick={() => checkIn(appointment.id)}
                    disabled={isCheckingIn}
                  >
                    <UsersRound size={17} /> Check in: {appointment.treatment}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
