import { compactQueueWaitCaption, formatWaitUpdatedAt, QUEUE_WAIT_DISCLAIMER } from "../utils/queueWaitEstimate";

export function PatientQueueBoard({
  entries = [],
  lastUpdatedAt,
  emptyDetail = "When you check in, your queue number and estimated wait appear here.",
}) {
  const updated = formatWaitUpdatedAt(lastUpdatedAt);
  const rows = Array.isArray(entries) ? entries : [];

  return (
    <section className="glass-card patient-queue-board" aria-label="Clinic queue">
      <div className="card-heading">
        <div>
          <span className="eyebrow">Queue</span>
          <h2>Live wait times</h2>
          <p>Queue numbers only. Waiting times may change as patients are called.</p>
        </div>
      </div>
      {rows.length ? (
        <ul className="patient-queue-board__list">
          {rows.map((entry) => {
            const yours = Boolean(entry.isCurrentPatient);
            return (
              <li
                key={entry.token || entry.queueNumber}
                className={`patient-queue-board__row${yours ? " is-you" : ""}`}
              >
                <div>
                  <strong>{entry.token || entry.queueNumber}</strong>
                  {yours ? <span className="patient-queue-board__you">You</span> : null}
                </div>
                <small>{compactQueueWaitCaption(entry)}</small>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted-copy">{emptyDetail}</p>
      )}
      <p className="patient-queue-board__meta">
        {updated ? <span>Last updated {updated}</span> : <span>Last updated —</span>}
        <span>{QUEUE_WAIT_DISCLAIMER}</span>
      </p>
    </section>
  );
}
