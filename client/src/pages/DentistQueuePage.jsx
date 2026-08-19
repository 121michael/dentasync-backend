import { useCallback, useEffect, useState } from "react";
import { PhoneCall, RefreshCw } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { DentistModal, DentistStatusBadge } from "../components/DentistUI";
import { formatDentistDateTime } from "../dentistUtils";

const tabs = [
  { id: "ongoing", label: "On Going" },
  { id: "inline", label: "In Line" },
  { id: "completed", label: "Completed" },
];

export function DentistQueuePage() {
  const [tab, setTab] = useState("ongoing");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState("");
  const [pendingComplete, setPendingComplete] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await api.getDentistQueue(tab));
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [tab]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function callNext() {
    setBusy("call-next");
    setError("");
    setSuccess("");
    try {
      const response = await api.callNextDentistPatient();
      setSuccess(response.message);
      setTab("ongoing");
      setData(await api.getDentistQueue("ongoing"));
    } catch (callError) {
      setError(callError.message);
    } finally {
      setBusy("");
    }
  }

  async function completePatient() {
    if (!pendingComplete) return;
    setBusy(`complete-${pendingComplete.id}`);
    setError("");
    setSuccess("");
    try {
      await api.updateDentistQueue(pendingComplete.id, { status: "completed" });
      setSuccess(`${pendingComplete.patientName} marked as complete.`);
      setPendingComplete(null);
      await load();
    } catch (completeError) {
      setError(completeError.message);
    } finally {
      setBusy("");
    }
  }

  async function setWaiting(entry) {
    setBusy(`wait-${entry.id}`);
    setError("");
    try {
      await api.updateDentistQueue(entry.id, { status: "waiting" });
      await load();
    } catch (waitError) {
      setError(waitError.message);
    } finally {
      setBusy("");
    }
  }

  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading live patient treatment queue…" />;

  const queue = data.queue || [];

  return (
    <div className="dentist-page">
      <SectionHeading
        eyebrow="Chairside operations"
        title="Live Patient Treatment Queue"
        detail={formatDentistDateTime(data.updatedAt)}
        action={
          <div className="dentist-heading-actions">
            <button className="button button--secondary" onClick={load}>
              <RefreshCw size={16} /> Refresh
            </button>
            <button className="button button--primary" onClick={callNext} disabled={Boolean(busy)}>
              <PhoneCall size={16} /> {busy === "call-next" ? "Calling…" : "+ Call Next Patient"}
            </button>
          </div>
        }
      />

      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}
      {success ? <p className="inline-alert inline-alert--success">{success}</p> : null}

      <section className="dentist-panel dentist-panel--table">
        <div className="dentist-panel__heading">
          <div>
            <span className="eyebrow">Treatment priority stream</span>
            <h2>Patient Queue</h2>
          </div>
          <div className="dentist-tabs" role="tablist" aria-label="Queue tabs">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                className={`dentist-tab ${tab === item.id ? "is-active" : ""}`}
                onClick={() => setTab(item.id)}
              >
                {item.label}
                <span>{data.counts?.[item.id] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>

        {queue.length ? (
          <div className="dentist-table-wrap">
            <table className="dentist-table">
              <thead>
                <tr>
                  <th>Sequence</th>
                  <th>Patient Profile</th>
                  <th>Procedure Schema</th>
                  <th>Status Check</th>
                  <th>Operational Control</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((entry) => (
                  <tr key={entry.id}>
                    <td><strong>#{String(entry.sequence).padStart(2, "0")}</strong></td>
                    <td>
                      <strong>{entry.patientName}</strong>
                      <small>{entry.patientPhone || entry.token || "Checked in"}</small>
                    </td>
                    <td>{entry.procedure}</td>
                    <td><DentistStatusBadge status={entry.status} /></td>
                    <td>
                      <div className="dentist-row-actions">
                        {entry.status !== "completed" && entry.status !== "no_show" ? (
                          <button
                            className="button button--primary button--compact"
                            disabled={Boolean(busy)}
                            onClick={() => setPendingComplete(entry)}
                          >
                            Complete
                          </button>
                        ) : null}
                        {entry.status === "in_chair" ? (
                          <button
                            className="button button--secondary button--compact"
                            disabled={Boolean(busy)}
                            onClick={() => setWaiting(entry)}
                          >
                            Return to Waiting
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No records found."
            detail="Patients in this queue tab will appear after check-in or treatment progress."
          />
        )}
      </section>

      {pendingComplete ? (
        <DentistModal title="Complete Treatment?" onClose={() => setPendingComplete(null)}>
          <p className="dentist-confirm-copy">
            Mark {pendingComplete.patientName}&apos;s {pendingComplete.procedure} as completed?
          </p>
          <div className="dentist-modal__actions">
            <button type="button" className="button button--secondary" onClick={() => setPendingComplete(null)}>
              Cancel
            </button>
            <button type="button" className="button button--primary" onClick={completePatient} disabled={Boolean(busy)}>
              Complete
            </button>
          </div>
        </DentistModal>
      ) : null}
    </div>
  );
}
