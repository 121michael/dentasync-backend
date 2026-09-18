import { useCallback, useEffect, useState } from "react";
import { PhoneCall, RefreshCw } from "lucide-react";

import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { DentistModal, DentistStatusBadge } from "../components/DentistUI";
import { TREATMENT_OPTIONS } from "../components/DentalChart/dentalChartData";
import { formatDentistDateTime } from "../dentistUtils";

const tabs = [
  { id: "ongoing", label: "On Going" },
  { id: "inline", label: "In Line" },
  { id: "completed", label: "Completed" },
];

function clinicTodayIso() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}

function emptyStartForm(entry = null) {
  return {
    patientName: entry?.patientName || "",
    procedureType: "",
    procedureName: entry?.procedure || "",
    toothNumber: "",
    amountCharged: "",
    durationMinutes: "",
    treatmentDate: clinicTodayIso(),
    notes: "",
  };
}

function formatWaitLabel(entry) {
  if (entry.status === "in_chair") {
    const minutes = entry.durationMinutes || entry.waitMinutes;
    return minutes ? `${minutes} min procedure` : "In service";
  }
  if (entry.status === "completed" || entry.status === "no_show") {
    return "—";
  }
  const minutes = Number(entry.waitMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return "Next / ~0 min";
  }
  return `Est. wait ${minutes} min`;
}

export function DentistQueuePage() {
  const [tab, setTab] = useState("inline");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState("");
  const [pendingComplete, setPendingComplete] = useState(null);
  const [durationMinutes, setDurationMinutes] = useState("");
  const [pendingStart, setPendingStart] = useState(null);
  const [startForm, setStartForm] = useState(emptyStartForm());

  const load = useCallback(async (options = {}) => {
    try {
      setData(await api.getDentistQueue(tab, options));
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [tab]);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load({ silent: true }), 12000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function callNext() {
    setBusy("call-next");
    setError("");
    setSuccess("");
    try {
      const response = await api.callNextDentistPatient();
      setSuccess(response.message || "Next patient called.");
      setTab("ongoing");
      setData(await api.getDentistQueue("ongoing"));
    } catch (callError) {
      setError(callError.message);
    } finally {
      setBusy("");
    }
  }

  function openComplete(entry) {
    setPendingComplete(entry);
    setDurationMinutes(
      entry.durationMinutes || entry.duration_minutes || entry.procedureDurationMinutes || entry.waitMinutes || ""
    );
  }

  async function completePatient() {
    if (!pendingComplete) return;
    setBusy(`complete-${pendingComplete.id}`);
    setError("");
    setSuccess("");
    try {
      const minutes = Number(durationMinutes);
      if (pendingComplete.status === "in_chair" && Number.isFinite(minutes) && minutes > 0) {
        await api.setDentistProcedureDuration(pendingComplete.id, {
          durationMinutes: minutes,
        });
      }
      const response = await api.updateDentistQueue(pendingComplete.id, {
        status: "completed",
        ...(Number.isFinite(minutes) && minutes > 0 ? { durationMinutes: minutes } : {}),
      });
      setSuccess(
        response.message ||
          `${pendingComplete.patientName} marked Done — treatment saved to the patient record.`
      );
      setPendingComplete(null);
      setDurationMinutes("");
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

  function openStartTreatment(entry) {
    setPendingStart(entry);
    setStartForm(emptyStartForm(entry));
    setError("");
    setSuccess("");
  }

  function updateStartForm(field, value) {
    setStartForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "procedureType") {
        const selected = TREATMENT_OPTIONS.find((option) => option.value === value);
        if (selected && selected.value !== "other") {
          next.procedureName = selected.label;
        }
      }
      return next;
    });
  }

  async function submitStartTreatment(event) {
    event.preventDefault();
    if (!pendingStart) return;

    const minutes = Number(startForm.durationMinutes);
    const amount = Number(startForm.amountCharged);
    if (!startForm.procedureType) {
      setError("Select the type of procedure.");
      return;
    }
    if (!String(startForm.procedureName || "").trim()) {
      setError("Enter the procedure / treatment name.");
      return;
    }
    if (!Number.isFinite(minutes) || minutes <= 0) {
      setError("Enter how long the treatment will take in minutes.");
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      setError("Enter a valid treatment price.");
      return;
    }

    setBusy(`start-${pendingStart.id}`);
    setError("");
    setSuccess("");
    try {
      const response = await api.startDentistTreatment(pendingStart.id, {
        procedureType: startForm.procedureType,
        procedureName: String(startForm.procedureName).trim(),
        toothNumber: String(startForm.toothNumber || "").trim() || undefined,
        durationMinutes: minutes,
        amountCharged: amount,
        treatmentDate: startForm.treatmentDate || clinicTodayIso(),
        notes: String(startForm.notes || "").trim() || undefined,
      });
      setSuccess(
        response.message ||
          `${pendingStart.patientName}'s ongoing treatment started. Press Done when finished to save the record.`
      );
      setPendingStart(null);
      setStartForm(emptyStartForm());
      setTab("ongoing");
      setData(await api.getDentistQueue("ongoing"));
    } catch (startError) {
      setError(startError.message);
    } finally {
      setBusy("");
    }
  }

  async function markCalled(entry) {
    setBusy(`call-${entry.id}`);
    setError("");
    try {
      await api.updateDentistQueue(entry.id, { status: "called" });
      setSuccess(`${entry.patientName} marked as called.`);
      await load();
    } catch (callError) {
      setError(callError.message);
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
            <button type="button" className="button button--secondary" onClick={load}>
              <RefreshCw size={16} /> Refresh
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={callNext}
              disabled={Boolean(busy)}
            >
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
                  <th>Est. Wait</th>
                  <th>Status Check</th>
                  <th>Operational Control</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <strong>#{String(entry.sequence).padStart(2, "0")}</strong>
                    </td>
                    <td>
                      <strong>{entry.patientName}</strong>
                      <small>{entry.patientPhone || entry.token || "Checked in"}</small>
                    </td>
                    <td>{entry.procedure}</td>
                    <td>
                      <strong>{formatWaitLabel(entry)}</strong>
                      {entry.status !== "in_chair" &&
                      entry.status !== "completed" &&
                      entry.status !== "no_show" &&
                      Number(entry.waitMinutes) > 0 ? (
                        <small>Based on current procedure length ahead</small>
                      ) : null}
                    </td>
                    <td>
                      <DentistStatusBadge status={entry.status} />
                    </td>
                    <td>
                      <div className="dentist-row-actions">
                        {entry.status === "in_chair" ? (
                          <button
                            type="button"
                            className="button button--primary button--compact"
                            disabled={Boolean(busy)}
                            onClick={() => openComplete(entry)}
                          >
                            {busy === `complete-${entry.id}` ? "Saving…" : "Done"}
                          </button>
                        ) : null}
                        {entry.status === "in_chair" ? (
                          <button
                            type="button"
                            className="button button--secondary button--compact"
                            disabled={Boolean(busy)}
                            onClick={() => setWaiting(entry)}
                          >
                            Return to Waiting
                          </button>
                        ) : null}
                        {entry.status === "called" ? (
                          <button
                            type="button"
                            className="button button--primary button--compact"
                            disabled={Boolean(busy)}
                            onClick={() => openStartTreatment(entry)}
                          >
                            Start treatment
                          </button>
                        ) : null}
                        {entry.status !== "completed" &&
                        entry.status !== "no_show" &&
                        entry.status !== "in_chair" &&
                        entry.status !== "called" ? (
                          <>
                            <button
                              type="button"
                              className="button button--secondary button--compact"
                              disabled={Boolean(busy)}
                              onClick={() => markCalled(entry)}
                            >
                              Call patient
                            </button>
                            <button
                              type="button"
                              className="button button--primary button--compact"
                              disabled={Boolean(busy)}
                              onClick={() => openStartTreatment(entry)}
                            >
                              Start treatment
                            </button>
                            <button
                              type="button"
                              className="button button--secondary button--compact"
                              disabled={Boolean(busy)}
                              onClick={() => openComplete(entry)}
                            >
                              Done
                            </button>
                          </>
                        ) : null}
                        {entry.status === "called" ? (
                          <button
                            type="button"
                            className="button button--secondary button--compact"
                            disabled={Boolean(busy)}
                            onClick={() => openComplete(entry)}
                          >
                            Done
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
            detail="After staff RFID or desk check-in, patients appear under In Line for your dentist schedule. Use Call Next to move them to On Going."
          />
        )}
      </section>

      {pendingStart ? (
        <DentistModal
          title="Start ongoing treatment"
          wide
          onClose={() => {
            if (!busy) {
              setPendingStart(null);
              setStartForm(emptyStartForm());
            }
          }}
        >
          <form className="dentist-form" onSubmit={submitStartTreatment}>
            <p className="dentist-confirm-copy">
              Capture the procedure for <strong>{pendingStart.patientName}</strong>. This starts an
              ongoing treatment. It is finalized to the patient record only when you press{" "}
              <strong>Done</strong>. Waiting patients will see an estimated wait based on the
              duration you enter.
            </p>

            <div className="field-grid field-grid--two">
              <label className="field">
                <span>Patient name</span>
                <input value={startForm.patientName} readOnly />
              </label>
              <label className="field">
                <span>Treatment date</span>
                <input type="date" value={startForm.treatmentDate} readOnly />
              </label>
              <label className="field">
                <span>Type of procedure</span>
                <select
                  required
                  value={startForm.procedureType}
                  onChange={(event) => updateStartForm("procedureType", event.target.value)}
                >
                  <option value="">Select procedure type</option>
                  {TREATMENT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Procedure / treatment name</span>
                <input
                  required
                  value={startForm.procedureName}
                  onChange={(event) => updateStartForm("procedureName", event.target.value)}
                  placeholder="e.g. Upper molar composite filling"
                />
              </label>
              <label className="field">
                <span>Tooth number (if needed)</span>
                <input
                  value={startForm.toothNumber}
                  onChange={(event) => updateStartForm("toothNumber", event.target.value)}
                  placeholder="FDI e.g. 16 or 11,21"
                />
              </label>
              <label className="field">
                <span>Price / amount charged (₱)</span>
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={startForm.amountCharged}
                  onChange={(event) => updateStartForm("amountCharged", event.target.value)}
                  placeholder="1500"
                />
              </label>
              <label className="field">
                <span>Duration (minutes)</span>
                <input
                  required
                  type="number"
                  min="1"
                  step="1"
                  value={startForm.durationMinutes}
                  onChange={(event) => updateStartForm("durationMinutes", event.target.value)}
                  placeholder="e.g. 45"
                />
              </label>
              <label className="field">
                <span>Notes (optional)</span>
                <input
                  value={startForm.notes}
                  onChange={(event) => updateStartForm("notes", event.target.value)}
                  placeholder="Chairside notes"
                />
              </label>
            </div>

            <div className="dentist-modal__actions">
              <button
                type="button"
                className="button button--secondary"
                disabled={Boolean(busy)}
                onClick={() => {
                  setPendingStart(null);
                  setStartForm(emptyStartForm());
                }}
              >
                Cancel
              </button>
              <button type="submit" className="button button--primary" disabled={Boolean(busy)}>
                {busy.startsWith("start-") ? "Starting…" : "Start ongoing treatment"}
              </button>
            </div>
          </form>
        </DentistModal>
      ) : null}

      {pendingComplete ? (
        <DentistModal title="Mark treatment Done?" onClose={() => setPendingComplete(null)}>
          <p className="dentist-confirm-copy">
            Mark {pendingComplete.patientName}&apos;s {pendingComplete.procedure} as Done? This
            finalizes the ongoing treatment into the patient clinical record and frees the chair for
            the next patient.
          </p>
          {pendingComplete.status === "in_chair" ? (
            <label className="field" style={{ marginBottom: "1rem" }}>
              <span>Actual procedure duration (minutes)</span>
              <input
                type="number"
                min="1"
                value={durationMinutes}
                onChange={(event) => setDurationMinutes(event.target.value)}
                placeholder="e.g. 45"
              />
            </label>
          ) : null}
          <div className="dentist-modal__actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setPendingComplete(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={completePatient}
              disabled={Boolean(busy)}
            >
              {busy.startsWith("complete-") ? "Saving…" : "Done — save to record"}
            </button>
          </div>
        </DentistModal>
      ) : null}
    </div>
  );
}
