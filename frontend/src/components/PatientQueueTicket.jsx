import { Ticket } from "lucide-react";
import { displayQueueStatus } from "../utils/walkInQr";
import { formatWaitUpdatedAt, ticketWaitPanel, TICKET_WAIT_NOTE } from "../utils/queueWaitEstimate";

export function PatientQueueTicket({ entry, lastUpdatedAt }) {
  if (!entry?.token && !entry?.queueNumber) return null;
  const token = entry.token || entry.queueNumber;
  const updated = formatWaitUpdatedAt(lastUpdatedAt || entry?.waitEstimate?.calculatedAt);
  const panel = ticketWaitPanel(entry);
  const showWaitNote = panel.kind === "waiting";

  return (
    <section className="glass-card patient-queue-ticket" aria-label="Your queue ticket">
      <header className="patient-queue-ticket__header">
        <div className="patient-queue-ticket__title">
          <span className="patient-queue-ticket__icon" aria-hidden="true">
            <Ticket size={18} />
          </span>
          <h2>Your Queue Ticket</h2>
        </div>
        {updated ? <p className="patient-queue-ticket__updated">Last updated {updated}</p> : null}
      </header>
      <div className="patient-queue-ticket__body">
        <div className="patient-queue-ticket__identity">
          <p className="patient-queue-ticket__number">{token}</p>
          <span className={`status-pill status-pill--${String(entry.status || "waiting").toLowerCase()}`}>
            {displayQueueStatus(entry.status)}
          </span>
        </div>
        <div className={`patient-queue-ticket__panel is-${panel.kind}`}>
          {panel.title ? <span>{panel.title}</span> : null}
          <strong>{panel.value}</strong>
        </div>
      </div>
      {showWaitNote ? <p className="patient-queue-ticket__footer">{TICKET_WAIT_NOTE}</p> : null}
    </section>
  );
}
