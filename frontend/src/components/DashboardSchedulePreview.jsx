import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";

function statusText(row) {
  if (row.queueStatus) return String(row.queueStatus).replaceAll("_", " ");
  return String(row.appointmentStatus || "scheduled").replaceAll("_", " ");
}

export function DashboardSchedulePreview({
  rows = [],
  appointmentBase,
  queueBase,
  rowTo,
  emptyTitle = "No visits on today’s schedule",
  emptyDetail = "Booked patients for the clinic date will appear here.",
  emptyAction = null,
}) {
  if (!rows.length) {
    return (
      <p className="ops-schedule-empty">
        {emptyTitle} {emptyAction}
        {!emptyAction && emptyDetail ? <span> {emptyDetail}</span> : null}
      </p>
    );
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
        const href = rowTo ? rowTo(row) : appointmentTo;
        const body = (
          <>
            <div>
              <strong>{row.patientName}</strong>
              <span>{row.service}</span>
            </div>
            <div className="ops-schedule__meta">
              <span>{row.timeLabel || (row.time ? row.time : "Date only")}</span>
              <span className="ops-schedule__status">{statusText(row)}</span>
            </div>
            {href ? <ChevronRight className="ops-schedule__arrow" size={18} aria-hidden="true" /> : null}
            {!href && (appointmentTo || queueTo) ? (
              <div className="ops-schedule__links">
                {appointmentTo ? <Link to={appointmentTo}>Appointment</Link> : null}
                {queueTo ? <Link to={queueTo}>Queue</Link> : null}
              </div>
            ) : null}
          </>
        );
        if (href) {
          return (
            <li key={row.appointmentId}>
              <Link
                className="ops-schedule__row ops-schedule__row--link"
                to={href}
                aria-label={`${row.patientName}, ${row.timeLabel || "Date only"}, ${statusText(row)}. Open appointment details.`}
              >
                {body}
              </Link>
            </li>
          );
        }
        return (
          <li key={row.appointmentId} className="ops-schedule__row">
            {body}
          </li>
        );
      })}
    </ul>
  );
}
