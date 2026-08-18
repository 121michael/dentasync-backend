import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw, Save } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { statusLabel } from "../staffUtils";
import {
  StaffDataTable,
  StaffStatusBadge,
} from "../components/StaffUI";

const queueStatuses = ["checked_in", "waiting", "preparing", "in_chair", "completed", "no_show"];

function waitLabel(entry) {
  if (entry.status === "completed") return "Completed";
  if (entry.status === "no_show") return "No show";
  if (entry.status === "in_chair") return "Now";
  return `${entry.waitMinutes || 0} mins`;
}

export function StaffQueuePage() {
  const [queueData, setQueueData] = useState(null);
  const [draftStatuses, setDraftStatuses] = useState({});
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [isExporting, setIsExporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await api.getStaffQueue();
      setQueueData(response);
      setDraftStatuses((current) => {
        const next = { ...current };
        response.queue.forEach((entry) => {
          if (!next[entry.id]) next[entry.id] = entry.status;
        });
        return next;
      });
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
    const refresh = window.setInterval(load, 25000);
    return () => window.clearInterval(refresh);
  }, [load]);

  async function updateQueue(entry) {
    const status = draftStatuses[entry.id] || entry.status;
    setSavingId(entry.id);
    setError("");
    try {
      const response = await api.updateStaffQueue(entry.id, { status });
      setQueueData((current) => ({
        ...current,
        queue: current.queue.map((item) =>
          item.id === entry.id
            ? {
                ...item,
                status: response.queueEntry.status,
                waitMinutes: response.queueEntry.waitMinutes,
              }
            : item
        ),
      }));
      setDraftStatuses((current) => ({ ...current, [entry.id]: response.queueEntry.status }));
    } catch (updateError) {
      setError(updateError.message);
    } finally {
      setSavingId(null);
    }
  }

  async function exportQueue() {
    setIsExporting(true);
    setError("");
    try {
      await api.downloadStaffExport("queue");
    } catch (exportError) {
      setError(exportError.message);
    } finally {
      setIsExporting(false);
    }
  }

  if (error && !queueData) return <ErrorState message={error} onRetry={load} />;
  if (!queueData) return <LoadingState label="Loading the live clinic queue…" />;

  const queue = queueData.queue || [];

  return (
    <div className="staff-page">
      <SectionHeading
        eyebrow="Clinic flow"
        title="Queue Management"
        detail="Live Queue Monitor"
        action={
          <div className="staff-heading-actions">
            <button className="button button--secondary" onClick={load}>
              <RefreshCw size={16} /> Refresh
            </button>
            <button className="button button--primary" onClick={exportQueue} disabled={isExporting}>
              <Download size={16} /> {isExporting ? "Exporting…" : "Export Log"}
            </button>
          </div>
        }
      />

      {error && <p className="inline-alert inline-alert--error">{error}</p>}

      <section className="staff-panel staff-panel--table">
        <div className="staff-panel__heading">
          <div>
            <span className="eyebrow">Live operations</span>
            <h2>Queue Management</h2>
            <p>Update queue progress as patients move through their appointments.</p>
          </div>
          <span className="staff-live-indicator"><i /> Live Queue</span>
        </div>

        {queue.length ? (
          <StaffDataTable>
            <table className="staff-table">
              <thead>
                <tr>
                  <th>Queue #</th>
                  <th>Patient Name</th>
                  <th>Assigned Doctor</th>
                  <th>Status</th>
                  <th>Wait Time</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((entry) => (
                  <tr key={entry.id}>
                    <td data-label="Queue #"><strong>{entry.token || `#${String(entry.queueNumber).padStart(3, "0")}`}</strong></td>
                    <td data-label="Patient Name">{entry.patientName}</td>
                    <td data-label="Assigned Doctor">{entry.appointment.dentist}</td>
                    <td data-label="Status">
                      <div className="staff-status-editor">
                        <StaffStatusBadge status={entry.status} />
                        <select
                          aria-label={`Update ${entry.patientName}'s queue status`}
                          value={draftStatuses[entry.id] || entry.status}
                          onChange={(event) =>
                            setDraftStatuses((current) => ({ ...current, [entry.id]: event.target.value }))
                          }
                          disabled={savingId === entry.id}
                        >
                          {queueStatuses.map((status) => (
                            <option key={status} value={status}>{statusLabel(status)}</option>
                          ))}
                        </select>
                      </div>
                    </td>
                    <td data-label="Wait Time">{waitLabel(entry)}</td>
                    <td data-label="Action">
                      <button
                        className="button button--secondary button--compact"
                        onClick={() => updateQueue(entry)}
                        disabled={savingId === entry.id}
                      >
                        <Save size={15} /> {savingId === entry.id ? "Saving…" : "Update"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </StaffDataTable>
        ) : (
          <EmptyState
            title="The live queue is clear"
            detail="Patient queue entries will appear here after staff or patients complete check-in."
          />
        )}
      </section>
    </div>
  );
}
