import { Link } from "react-router-dom";
import { EmptyState } from "./UI";

function statusText(row) {
  if (row.queueStatus) return String(row.queueStatus).replaceAll("_", " ");
  return String(row.appointmentStatus || "scheduled").replaceAll("_", " ");
}

export function DashboardSchedulePreview({
  rows = [],
  appointmentBase,
  queueBase,
  emptyTitle = "No visits on today’s schedule",
  emptyDetail = "Booked patients for the clinic date will appear here.",
}) {
  if (!rows.length) {
    return <EmptyState title={emptyTitle} detail={emptyDetail} />;
  }

  return (
    <ul className="ops-schedule">
      {rows.map((row) => {
        const appointmentTo = appointmentBase
          ? `${appointmentBase}${appointmentBase.includes("?") ? "&" : "?"}focus=${encodeURIComponent(row.appointmentId)}`
          : null;
        const queueTo =
          queueBase && row.queueEntryId
            ? `${queueBase}${queueBase.includes("?") ? "&" : "?"}focus=${encodeURIComponent(row.queueNumber || row.queueEntryId)}`
            : null;
        return (
          <li key={row.appointmentId} className="ops-schedule__row">
            <div>
              <strong>{row.patientName}</strong>
              <span>{row.service}</span>
            </div>
            <div className="ops-schedule__meta">
              <span>{row.timeLabel || (row.time ? row.time : "Date only")}</span>
              <span className="ops-schedule__status">{statusText(row)}</span>
            </div>
            <div className="ops-schedule__links">
              {appointmentTo ? <Link to={appointmentTo}>Appointment</Link> : null}
              {queueTo ? <Link to={queueTo}>Queue</Link> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
