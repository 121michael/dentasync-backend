import { UsersRound } from "lucide-react";
import { displayQueueStatus } from "../utils/walkInQr";
import { formatWaitUpdatedAt } from "../utils/queueWaitEstimate";
import { dashboardNextInLine } from "../utils/precedingQueueTicket";
import { LIVE_QUEUE_FOOTER } from "./PatientQueueBoard";

export function DashboardLiveQueue({ entries = [], current = null, lastUpdatedAt }) {
  const updated = formatWaitUpdatedAt(lastUpdatedAt);
  const result = dashboardNextInLine(entries, current);

  let body = null;
  if (result.kind === "empty") {
    body = (
      <div className="patient-queue-board__empty">
        <strong>No active queue ticket</strong>
        <p>Check in at the clinic to see who is next in line.</p>
      </div>
    );
  } else if (result.kind === "in_progress") {
    body = (
      <div className="patient-queue-board__empty">
        <strong>Your treatment is in progress.</strong>
        <p>You are with the dentist now.</p>
      </div>
    );
  } else if (result.kind === "next") {
    body = (
      <div className="patient-queue-board__empty">
        <strong>You are next in line.</strong>
      </div>
    );
  } else if (result.ticket?.token) {
    body = (
      <>
        <p className="patient-queue-board__ahead-count">
          <strong>Next in line</strong>
        </p>
        <ul className="patient-queue-board__list">
          <li className="patient-queue-board__row patient-queue-board__row--ahead">
            <div className="patient-queue-board__identity">
              <strong>{result.ticket.token}</strong>
            </div>
            <span className="patient-queue-board__status">{displayQueueStatus(result.ticket.status)}</span>
          </li>
        </ul>
      </>
    );
  }

  return (
    <section className="glass-card patient-queue-board" aria-label="Live queue">
      <header className="patient-queue-board__header">
        <div className="patient-queue-board__title">
          <span className="patient-queue-board__icon" aria-hidden="true">
            <UsersRound size={18} />
          </span>
          <div>
            <h2>Live Queue</h2>
            <p>The person next in line for your dentist.</p>
          </div>
        </div>
        {updated ? <p className="patient-queue-board__updated">Last updated {updated}</p> : null}
      </header>
      {body}
      <p className="patient-queue-board__footer">{LIVE_QUEUE_FOOTER}</p>
    </section>
  );
}
