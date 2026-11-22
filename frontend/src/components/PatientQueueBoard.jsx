import { UsersRound } from "lucide-react";
import { displayQueueStatus } from "../utils/walkInQr";
import { formatWaitUpdatedAt, queueStatusWaitLabel } from "../utils/queueWaitEstimate";

export const LIVE_QUEUE_FOOTER = "Estimates may change as treatments progress.";

export function PatientQueueBoard({
  entries = [],
  lastUpdatedAt,
}) {
  const updated = formatWaitUpdatedAt(lastUpdatedAt);
  const rows = Array.isArray(entries) ? entries : [];

  return (
    <section className="glass-card patient-queue-board" aria-label="Live queue">
      <header className="patient-queue-board__header">
        <div className="patient-queue-board__title">
          <span className="patient-queue-board__icon" aria-hidden="true">
            <UsersRound size={18} />
          </span>
          <div>
            <h2>Live Queue</h2>
            <p>Your queue position and estimated waiting time.</p>
          </div>
        </div>
        {updated ? <p className="patient-queue-board__updated">Last updated {updated}</p> : null}
      </header>
      {rows.length ? (
        <ul className="patient-queue-board__list">
          {rows.map((entry) => {
            const yours = Boolean(entry.isCurrentPatient);
            return (
              <li
                key={entry.token || entry.queueNumber}
                className={`patient-queue-board__row${yours ? " is-you" : ""}`}
              >
                <div className="patient-queue-board__identity">
                  <strong>{entry.token || entry.queueNumber}</strong>
                  {yours ? <span className="patient-queue-board__you">Your ticket</span> : null}
                </div>
                <span className="patient-queue-board__status">{displayQueueStatus(entry.status)}</span>
                <span className="patient-queue-board__wait">{queueStatusWaitLabel(entry)}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="patient-queue-board__empty">
          <strong>No active queue ticket</strong>
          <p>Check in at the clinic to see your queue number and estimated wait.</p>
        </div>
      )}
      <p className="patient-queue-board__footer">{LIVE_QUEUE_FOOTER}</p>
    </section>
  );
}
