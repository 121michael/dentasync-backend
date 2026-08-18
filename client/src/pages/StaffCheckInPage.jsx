import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw, Radio } from "lucide-react";
import { api } from "../api";
import { ErrorState, LoadingState, SectionHeading, EmptyState } from "../components/UI";
import {
  formatStaffDate,
  formatStaffDateTime,
  StaffDataTable,
  StaffStatusBadge,
} from "../components/StaffUI";

export function StaffCheckInPage() {
  const [checkInData, setCheckInData] = useState(null);
  const [error, setError] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await api.getStaffCheckIns();
      setCheckInData(response);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
    const refresh = window.setInterval(load, 30000);
    return () => window.clearInterval(refresh);
  }, [load]);

  async function exportLog() {
    setIsExporting(true);
    setError("");
    try {
      await api.downloadStaffExport("check-ins");
    } catch (exportError) {
      setError(exportError.message);
    } finally {
      setIsExporting(false);
    }
  }

  if (error && !checkInData) return <ErrorState message={error} onRetry={load} />;
  if (!checkInData) return <LoadingState label="Loading today's patient check-ins…" />;

  const checkIns = checkInData.checkIns || [];

  return (
    <div className="staff-page">
      <SectionHeading
        eyebrow="Front desk operations"
        title="Patient Check-in Log"
        detail={formatStaffDate(new Date())}
        action={
          <div className="staff-heading-actions">
            <button className="button button--secondary" onClick={load}>
              <RefreshCw size={16} /> Refresh
            </button>
            <button className="button button--primary" onClick={exportLog} disabled={isExporting}>
              <Download size={16} /> {isExporting ? "Exporting…" : "Export Log"}
            </button>
          </div>
        }
      />

      {error && <p className="inline-alert inline-alert--error">{error}</p>}

      <section className="staff-panel staff-panel--table">
        <div className="staff-panel__heading">
          <div>
            <span className="eyebrow">Reception desk</span>
            <h2>Today&apos;s Live Arrivals</h2>
            <p>Track patients as they arrive and check in for their appointments.</p>
          </div>
          <span className="staff-live-indicator">
            <Radio size={15} /> Updated Live
          </span>
        </div>

        {checkIns.length ? (
          <StaffDataTable>
            <table className="staff-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Patient ID</th>
                  <th>Patient Name</th>
                  <th>Appointment Details</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {checkIns.map((checkIn) => (
                  <tr key={checkIn.id}>
                    <td data-label="Timestamp">
                      <strong>{formatStaffDateTime(checkIn.timestamp)}</strong>
                    </td>
                    <td data-label="Patient ID"><code>{checkIn.patientId}</code></td>
                    <td data-label="Patient Name"><strong>{checkIn.patientName}</strong></td>
                    <td data-label="Appointment Details">
                      <strong>{checkIn.appointment.treatment}</strong>
                      <small>
                        {checkIn.appointment.dentist} · {formatStaffDate(checkIn.appointment.date)} · {formatStaffTime(checkIn.appointment.time)}
                      </small>
                    </td>
                    <td data-label="Status"><StaffStatusBadge status={checkIn.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </StaffDataTable>
        ) : (
          <EmptyState
            title="No arrivals have checked in"
            detail="Today’s patient arrivals will appear here as soon as they check in."
          />
        )}
      </section>
    </div>
  );
}
