import {
  featuredWaitValue,
  formatWaitUpdatedAt,
  queueRowStatusLabel,
} from "../utils/queueWaitEstimate";

export function PatientQueueBoard({
  entries = [],
  lastUpdatedAt,
  selfEntry = null,
  emptyDetail = "When you check in, your queue number and estimated wait appear here.",
}) {
  const updated = formatWaitUpdatedAt(lastUpdatedAt);
  const rows = Array.isArray(entries) ? entries : [];
  const mine = selfEntry || rows.find((entry) => entry?.isCurrentPatient) || null;
  const featured = mine ? featuredWaitValue(mine) : null;

  return (
    <section className="glass-card patient-queue-board" aria-label="Live wait times">
      <div className="patient-queue-board__heading">
        <span className="eyebrow">Queue</span>
        <h2>Live wait times</h2>
        <p>Estimates may change as patients are called.</p>
      </div>
      {featured ? (
        <div className="patient-queue-board__featured" aria-live="polite">
          <span>Your estimated wait</span>
          <strong>{featured}</strong>
        </div>
      ) : null}
      {rows.length ? (
        <ul className="patient-queue-board__list">
          {rows.map((entry) => {
            const yours = Boolean(entry.isCurrentPatient);
            const token = entry.token || entry.queueNumber;
            return (
              <li
                key={token}
                className={`patient-queue-board__row${yours ? " is-you" : ""}`}
                aria-current={yours ? "true" : undefined}
              >
                <div className="patient-queue-board__token">
                  <strong>{token}</strong>
                  {yours ? <span className="patient-queue-board__you">You</span> : null}
                </div>
                <span className="patient-queue-board__status">{queueRowStatusLabel(entry)}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted-copy">{emptyDetail}</p>
      )}
      {updated ? <p className="patient-queue-board__meta">Last updated {updated}</p> : null}
    </section>
  );
}
