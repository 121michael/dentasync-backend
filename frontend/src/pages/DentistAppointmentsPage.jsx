import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { DentistStatusBadge } from "../components/DentistUI";
import { formatDentistDate, formatDentistDateTime, formatDentistTime } from "../dentistUtils";
import { matchesNotificationFocus } from "../notificationFocus";

export function DentistAppointmentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [focusKey, setFocusKey] = useState(() => searchParams.get("focus") || "");
  const focusedRowRef = useRef(null);

  const load = useCallback(async () => {
    try {
      setData(await api.getDentistAppointments());
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const focus = searchParams.get("focus");
    if (focus) setFocusKey(focus);
  }, [searchParams]);

  useEffect(() => {
    if (!focusKey || !data) return;
    const rows = [...(data.todayAppointments || []), ...(data.upcomingAppointments || [])];
    const match = rows.find((appointment) => matchesNotificationFocus(appointment, focusKey, ["id"]));
    if (!match) return;
    const timer = window.setTimeout(() => {
      focusedRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    const clearTimer = window.setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      if (next.has("focus")) {
        next.delete("focus");
        setSearchParams(next, { replace: true });
      }
    }, 4000);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(clearTimer);
    };
  }, [focusKey, data, searchParams, setSearchParams]);

  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading dentist appointments…" />;

  const today = data.todayAppointments || [];
  const upcoming = data.upcomingAppointments || [];

  return (
    <div className="dentist-page">
      <SectionHeading
        eyebrow="Clinical schedule"
        title="Appointments"
        detail={formatDentistDateTime(new Date())}
        action={
          <button className="button button--secondary" onClick={load}>
            <RefreshCw size={16} /> Refresh
          </button>
        }
      />

      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}

      <section className="dentist-panel dentist-panel--table">
        <div className="dentist-panel__heading">
          <div>
            <span className="eyebrow">Today</span>
            <h2>Today&apos;s Appointments</h2>
          </div>
        </div>
        {today.length ? (
          <div className="dentist-table-wrap">
            <table className="dentist-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Patient</th>
                  <th>Procedure</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {today.map((appointment) => (
                  <tr
                    key={appointment.id}
                    ref={matchesNotificationFocus(appointment, focusKey, ["id"]) ? focusedRowRef : null}
                    className={
                      matchesNotificationFocus(appointment, focusKey, ["id"])
                        ? "is-notification-focus"
                        : undefined
                    }
                  >
                    <td>{formatDentistTime(String(appointment.time || "").slice(0, 5))}</td>
                    <td>
                      <strong>{appointment.patientName}</strong>
                      <small>{appointment.patientPhone || "—"}</small>
                    </td>
                    <td>{appointment.treatment}</td>
                    <td><DentistStatusBadge status={appointment.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No appointments today." detail="Confirmed visits assigned to you will appear here." />
        )}
      </section>

      <section className="dentist-panel dentist-panel--table">
        <div className="dentist-panel__heading">
          <div>
            <span className="eyebrow">Upcoming</span>
            <h2>Upcoming Appointments</h2>
          </div>
        </div>
        {upcoming.length ? (
          <div className="dentist-table-wrap">
            <table className="dentist-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Patient</th>
                  <th>Procedure</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((appointment) => (
                  <tr
                    key={appointment.id}
                    ref={matchesNotificationFocus(appointment, focusKey, ["id"]) ? focusedRowRef : null}
                    className={
                      matchesNotificationFocus(appointment, focusKey, ["id"])
                        ? "is-notification-focus"
                        : undefined
                    }
                  >
                    <td>{formatDentistDate(appointment.date)}</td>
                    <td>{formatDentistTime(String(appointment.time || "").slice(0, 5))}</td>
                    <td>{appointment.patientName}</td>
                    <td>{appointment.treatment}</td>
                    <td><DentistStatusBadge status={appointment.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No upcoming appointments." detail="Future bookings for your chair will show here." />
        )}
      </section>
    </div>
  );
}
