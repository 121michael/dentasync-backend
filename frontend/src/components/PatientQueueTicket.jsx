import { Ticket } from "lucide-react";
import { displayQueueStatus } from "../utils/walkInQr";
import { formatWaitUpdatedAt, ticketWaitLine, TICKET_WAIT_NOTE } from "../utils/queueWaitEstimate";

export function PatientQueueTicket({ entry, lastUpdatedAt }) {
  if (!entry?.token && !entry?.queueNumber) return null;
  const token = entry.token || entry.queueNumber;
  const updated = formatWaitUpdatedAt(lastUpdatedAt || entry?.waitEstimate?.calculatedAt);
  return (
    <section className="glass-card patient-queue-ticket" aria-label="Your queue ticket">
      <div className="patient-queue-ticket__header">
        <div className="patient-queue-ticket__heading">
          <span className="eyebrow">Queue ticket</span>
          <p className="patient-queue-ticket__number">{token}</p>
        </div>
        <span className="patient-queue-ticket__icon" aria-hidden="true">
          <Ticket size={20} />
        </span>
      </div>
      <div className="patient-queue-ticket__badges">
        <span className={`status-pill status-pill--${String(entry.status || "waiting").toLowerCase()}`}>
          {displayQueueStatus(entry.status)}
        </span>
        {entry.visitType === "walk_in" ? <span className="status-pill">Walk-in visit</span> : null}
        {entry.visitType === "booked" ? <span className="status-pill">Booked appointment</span> : null}
      </div>
      <p className="patient-queue-ticket__wait">{ticketWaitLine(entry)}</p>
      <p className="patient-queue-ticket__meta">
        {updated ? <span>Last updated {updated}</span> : <span>Last updated —</span>}
        <span>{TICKET_WAIT_NOTE}</span>
      </p>
    </section>
  );
}
