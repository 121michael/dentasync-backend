import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, RotateCcw } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { StaffStatusBadge, StaffSummaryCard } from "../components/StaffUI";
import { useStaffUi } from "../components/StaffLayout";
import { formatStaffDateTime, formatStaffTime } from "../staffUtils";

const QUEUE_ACTIONS = [
  { value: "waiting", label: "Waiting" },
  { value: "called", label: "Called" },
  { value: "in_treatment", label: "In Treatment" },
  { value: "completed", label: "Completed" },
  { value: "skipped", label: "Skipped" },
];

function matchesFocus(entry, focus) {
  if (!focus) return false;
  const needle = String(focus).trim().toLowerCase();
  if (!needle) return false;
  return (
    String(entry.id) === String(focus) ||
    String(entry.token || "").toLowerCase() === needle ||
    String(entry.queueNumber || "").toLowerCase() === needle ||
    String(entry.token || "").toLowerCase() === needle.replace(/^#/, "")
  );
}

export function StaffQueuePage() {
  const { pushToast, confirm } = useStaffUi();
  const [searchParams, setSearchParams] = useSearchParams();
  const [queue, setQueue] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [focusKey, setFocusKey] = useState(() => searchParams.get("focus") || "");
  const focusedRowRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [queueResponse, summaryResponse] = await Promise.all([
        api.getStaffQueue(),
        api.getStaffQueueSummary().catch(() => null),
      ]);
      setQueue(queueResponse.queue || []);
      setSummary(summaryResponse);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 12000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const focus = searchParams.get("focus");
    if (!focus) return;
    setFocusKey(focus);
  }, [searchParams]);

  useEffect(() => {
    if (!focusKey || !queue?.length) return;
    const match = queue.find((entry) => matchesFocus(entry, focusKey));
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
    }, 12000);

    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(clearTimer);
    };
  }, [focusKey, queue, searchParams, setSearchParams]);

  async function updateStatus(entry, status) {
    if (status === "skipped") {
      const ok = await confirm({
        title: "Skip patient",
        message: `Are you sure you want to remove ${entry.patientName} from the active queue?`,
        confirmLabel: "Skip patient",
      });
      if (!ok) return;
    }
    setBusy(`${entry.id}-${status}`);
    try {
      await api.updateStaffQueue(entry.id, { status });
      pushToast("Queue updated successfully.");
      await load();
    } catch (updateError) {
      pushToast(updateError.message, "error");
    } finally {
      setBusy("");
    }
  }

  async function resetQueue() {
    const ok = await confirm({
      title: "Clear live queue",
      message: "Clear/reset the active queue for end-of-day clinic operations?",
      confirmLabel: "Clear queue",
    });
    if (!ok) return;
    setBusy("reset");
    try {
      const response = await api.resetStaffQueue();
      pushToast(response.message || "Queue cleared.");
      await load();
    } catch (resetError) {
      pushToast(resetError.message, "error");
    } finally {
      setBusy("");
    }
  }

  if (error && !queue) return <ErrorState message={error} onRetry={load} />;
  if (!queue) return <LoadingState label="Loading live patient queue…" />;

  const focusedEntry = focusKey ? queue.find((entry) => matchesFocus(entry, focusKey)) : null;

  return (
    <div className="staff-page">
      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}

      <section className="staff-stat-grid">
        <StaffSummaryCard label="Currently Waiting" value={summary?.currentlyWaiting ?? "—"} tone="amber" />
        <StaffSummaryCard label="In Treatment" value={summary?.inTreatment ?? "—"} tone="violet" />
        <StaffSummaryCard label="Completed" value={summary?.completed ?? "—"} tone="emerald" />
        <StaffSummaryCard
          label="Average Waiting Time"
          value={`${summary?.averageWaitingTime ?? 0} min`}
          detail="Estimated from live queue"
          tone="purple"
        />
      </section>

      {focusedEntry ? (
        <section className="staff-panel staff-focus-banner" aria-live="polite">
          <div>
            <span className="eyebrow">From notification</span>
            <h2>
              Queue #{focusedEntry.token || focusedEntry.queueNumber} — {focusedEntry.patientName}
            </h2>
            <p>
              Status: {(focusedEntry.status || "waiting").replaceAll("_", " ")}. The matching queue row is
              highlighted below.
            </p>
          </div>
        </section>
      ) : null}

      <section className="staff-panel staff-panel--table">
        <div className="staff-panel__heading">
          <div>
            <span className="eyebrow">Real-time synchronization</span>
            <h2>Live Patient Queue</h2>
            <p>Monitor queue activity and make minor adjustments. Clinical treatment controls stay with dentists.</p>
          </div>
          <div className="staff-heading-actions">
            <button className="button button--secondary" onClick={load} disabled={Boolean(busy)}>
              <RefreshCw size={16} /> Refresh
            </button>
            <button className="button button--danger" onClick={resetQueue} disabled={Boolean(busy)}>
              <RotateCcw size={16} /> Clear Queue
            </button>
          </div>
        </div>

        {queue.length ? (
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>Queue #</th>
                  <th>Patient</th>
                  <th>Appointment</th>
                  <th>Service</th>
                  <th>Dentist</th>
                  <th>Check-In Time</th>
                  <th>Queue Status</th>
                  <th>Estimated Wait</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((entry) => {
                  const isFocused = matchesFocus(entry, focusKey);
                  return (
                    <tr
                      key={entry.id}
                      ref={isFocused ? focusedRowRef : null}
                      className={isFocused ? "is-notification-focus" : undefined}
                    >
                      <td>
                        <code>{entry.token || entry.queueNumber}</code>
                      </td>
                      <td>
                        <strong>{entry.patientName}</strong>
                      </td>
                      <td>{formatStaffTime(String(entry.appointment?.time || "").slice(0, 5))}</td>
                      <td>{entry.appointment?.treatment || "—"}</td>
                      <td>{entry.appointment?.dentist || "—"}</td>
                      <td>{formatStaffDateTime(entry.timestamp)}</td>
                      <td>
                        <StaffStatusBadge status={entry.status} />
                      </td>
                      <td>{entry.waitMinutes ?? 0} min</td>
                      <td>
                        <label className="staff-inline-select">
                          <span className="sr-only">Update queue status</span>
                          <select
                            value={
                              entry.status === "preparing"
                                ? "called"
                                : entry.status === "in_chair" || entry.status === "dentist"
                                  ? "in_treatment"
                                  : entry.status === "no_show"
                                    ? "skipped"
                                    : entry.status
                            }
                            disabled={Boolean(busy)}
                            onChange={(event) => updateStatus(entry, event.target.value)}
                          >
                            {QUEUE_ACTIONS.map((action) => (
                              <option key={action.value} value={action.value}>
                                {action.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Queue is empty" detail="Checked-in patients will appear here in real time." />
        )}
      </section>
    </div>
  );
}
