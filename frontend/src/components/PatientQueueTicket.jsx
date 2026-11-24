import { Ticket } from "lucide-react";
import { displayQueueStatus } from "../utils/walkInQr";
import { formatWaitUpdatedAt, ticketWaitLine, TICKET_WAIT_NOTE } from "../utils/queueWaitEstimate";

export function PatientQueueTicket({ entry, lastUpdatedAt }) {
  if (!entry?.token && !entry?.queueNumber) return null;
  const token = entry.token || entry.queueNumber;
  const updated = formatWaitUpdatedAt(lastUpdatedAt || entry?.waitEstimate?.calculatedAt);

  return (
    <section className="glass-card patient-queue-ticket" aria-label="Your queue ticket">
      <div className="patient-queue-ticket__top">
        <div>
          <span className="eyebrow">Queue ticket</span>
          <p className="patient-queue-ticket__number">{token}</p>
          <span className={`status-pill status-pill--${String(entry.status || "waiting").toLowerCase()}`}>
            {displayQueueStatus(entry.status)}
          </span>
          {entry.visitType === "walk_in" ? (
            <span className="status-pill">Walk-in visit</span>
          ) : entry.visitType === "booked" ? (
            <span className="status-pill">Booked appointment</span>
          ) : null}
        </div>
        <span className="patient-queue-ticket__icon" aria-hidden="true">
          <Ticket size={22} />
        </span>
      </div>
      <p className="patient-queue-ticket__wait">{ticketWaitLine(entry)}</p>
      <p className="patient-queue-ticket__meta">
        {updated ? <span>Last updated {updated}</span> : <span>Last updated —</span>}
        <span>{TICKET_WAIT_NOTE}</span>
      </p>
    </section>
  );
}
