import { useCallback, useEffect, useRef, useState } from "react";
import { PhoneCall, RefreshCw } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { DentistModal, DentistStatusBadge } from "../components/DentistUI";
import { DentalChart } from "../components/DentalChart";
import {
  PROCEDURE_FORM_OPTIONS,
  procedureRequiresTooth,
} from "../components/DentalChart/dentalChartData";
import { formatDentistDateTime } from "../dentistUtils";
import { matchesNotificationFocus } from "../notificationFocus";
import {
  callRangeFromEntry,
  durationFromEntry,
  QUEUE_WAIT_DISCLAIMER,
  waitRangeFromEntry,
} from "../utils/queueWaitEstimate";

const tabs = [
  { id: "ongoing", label: "On Going" },
  { id: "inline", label: "In Line" },
  { id: "completed", label: "Completed" },
];

function clinicTodayIso() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}

function emptyProcedureDraft() {
  return {
    key: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: "",
    diagnosisNotes: "",
    toothNumber: "",
    amountCharged: "",
    durationMinutes: "",
    treatmentDate: clinicTodayIso(),
  };
}

function formatMoney(value) {
  return `₱${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatDurationMinutes(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return "—";
  const hours = Math.floor(n / 60);
  const mins = Math.round(n % 60);
  if (hours && mins) return `${hours} hr ${mins} min`;
  if (hours) return `${hours} hr`;
  return `${mins} min`;
}

function procedureStatusKey(status) {
  return String(status || "").toLowerCase();
}

function isPlannedStatus(status) {
  const value = procedureStatusKey(status);
  return value === "planned" || value === "pending";
}

function parseToothList(value) {
  return String(value || "")
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function procedureStatusLabel(status) {
  const value = procedureStatusKey(status);
  if (value === "planned" || value === "pending") return "Pending";
  if (value === "in_progress") return "In Treatment";
  if (value === "completed") return "Completed";
  return status ? String(status).replaceAll("_", " ") : "";
}

function procedureLine(procedure) {
  const name = procedure?.name || procedure?.treatment || "Procedure";
  const tooth = procedure?.toothNumber ? ` #${procedure.toothNumber}` : "";
  return `${name}${tooth}`;
}

function currentVisitProcedure(entry) {
  return (
    (entry?.procedures || []).find((procedure) => procedureStatusKey(procedure.status) === "in_progress") ||
    entry?.currentProcedure ||
    null
  );
}

function plannedVisitProcedures(entry) {
  return (entry?.procedures || []).filter((procedure) => isPlannedStatus(procedure.status));
}

function visitDurationMinutes(entry) {
  const fromProcedures = (entry?.procedures || []).reduce((sum, procedure) => {
    if (procedureStatusKey(procedure.status) === "completed") return sum;
    const minutes = Number(procedure.durationMinutes);
    return Number.isFinite(minutes) && minutes > 0 ? sum + minutes : sum;
  }, 0);
  if (fromProcedures > 0) return fromProcedures;
  const estimate = Number(entry?.estimatedDurationMinutes ?? entry?.durationMinutes ?? entry?.waitMinutes);
  return Number.isFinite(estimate) && estimate > 0 ? estimate : 0;
}

function QueueProcedureList({ entry }) {
  const procedures = entry.procedures || [];
  if (!procedures.length) {
    return (
      <div className="queue-procedure-cell">
        <small>Procedures</small>
        <strong>No procedures added yet</strong>
      </div>
    );
  }
  const inChair = entry.status === "in_chair";
  const current = currentVisitProcedure(entry);
  const upcoming = plannedVisitProcedures(entry);
  return (
    <div className="queue-procedure-cell">
      <small>
        {inChair ? "In Treatment" : "Planned procedures"} · {procedures.length}
      </small>
      {inChair && current ? (
        <>
          <small>Current</small>
          <strong>
            {procedureLine(current)} · {procedureStatusLabel(current.status) || "In Treatment"}
          </strong>
        </>
      ) : null}
      {(inChair ? upcoming : procedures).length ? (
        <>
          {inChair ? <small>Pending</small> : null}
          <ul>
            {(inChair ? upcoming : procedures).map((procedure) => (
              <li key={procedure.id || procedureLine(procedure)}>
                {procedureLine(procedure)}
                {procedure.status ? ` · ${procedureStatusLabel(procedure.status)}` : ""}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function formatWaitLabel(entry) {
  if (entry.status === "in_chair") {
    const remaining = durationFromEntry(entry);
    return remaining && remaining !== "—" ? `${remaining} remaining` : "In treatment";
  }
  if (entry.status === "completed" || entry.status === "no_show") {
    return "—";
  }
  return waitRangeFromEntry(entry);
}

function ProcedureFields({ draft, onChange, requiredTooth }) {
  return (
    <div className="field-grid field-grid--two">
      <label className="field">
        <span>Treatment Type</span>
        <select required value={draft.name} onChange={(event) => onChange({ name: event.target.value })}>
          <option value="">Select Treatment</option>
          {PROCEDURE_FORM_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label || option.value}
            </option>
          ))}
          {draft.name && !PROCEDURE_FORM_OPTIONS.some((option) => option.value === draft.name) ? (
            <option value={draft.name}>{draft.name}</option>
          ) : null}
        </select>
      </label>
      <label className="field">
        <span>Amount</span>
        <input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={draft.amountCharged}
          onChange={(event) => onChange({ amountCharged: event.target.value })}
          placeholder="₱"
        />
      </label>
      <label className="field">
        <span>Expected duration (minutes, optional)</span>
        <input
          type="number"
          min="1"
          step="1"
          value={draft.durationMinutes}
          onChange={(event) => onChange({ durationMinutes: event.target.value })}
          placeholder="Uses historical average if blank"
        />
      </label>
      <label className="field">
        <span>Tooth Number{requiredTooth ? "" : " (optional)"}</span>
        <input
          value={draft.toothNumber}
          onChange={(event) => onChange({ toothNumber: event.target.value })}
          placeholder={requiredTooth ? "Click the tooth on the chart" : "Not required"}
          required={requiredTooth}
        />
      </label>
      <label className="field field--full">
        <span>Diagnosis</span>
        <textarea
          rows="2"
          value={draft.diagnosisNotes}
          onChange={(event) => onChange({ diagnosisNotes: event.target.value })}
          placeholder="e.g. Dental Caries"
        />
      </label>
    </div>
  );
}

export function DentistQueuePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(() => {
    const urlTab = searchParams.get("tab");
    return tabs.some((item) => item.id === urlTab) ? urlTab : "inline";
  });
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState("");
  const [pendingComplete, setPendingComplete] = useState(null);
  const [durationMinutes, setDurationMinutes] = useState("");
  const [pendingStart, setPendingStart] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [pendingAdd, setPendingAdd] = useState(null);
  const [procedureDrafts, setProcedureDrafts] = useState(() => [emptyProcedureDraft()]);
  const [activeDraftIndex, setActiveDraftIndex] = useState(0);
  const [addError, setAddError] = useState("");
  const [procedureErrors, setProcedureErrors] = useState({});
  const [pendingEdit, setPendingEdit] = useState(null);
  const [editForm, setEditForm] = useState(emptyProcedureDraft());
  const [editError, setEditError] = useState("");
  const [pendingRemove, setPendingRemove] = useState(null);
  const [focusKey, setFocusKey] = useState(() => searchParams.get("focus") || "");
  const focusedRowRef = useRef(null);
  const triedTabsRef = useRef(new Set());

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

  useEffect(() => {
    const urlTab = searchParams.get("tab");
    if (urlTab && tabs.some((item) => item.id === urlTab) && urlTab !== tab) {
      setTab(urlTab);
    }
    const focus = searchParams.get("focus");
    if (focus && focus !== focusKey) {
      setFocusKey(focus);
      triedTabsRef.current = new Set();
    }
  }, [searchParams, tab, focusKey]);

  useEffect(() => {
    if (!focusKey || !data) return;
    const queue = data.queue || [];
    const match = queue.find((entry) =>
      matchesNotificationFocus(entry, focusKey, ["id", "token", "sequence", "appointmentId"])
    );
    if (match) {
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
    }

    const order = ["inline", "ongoing", "completed"];
    triedTabsRef.current.add(tab);
    const nextTab = order.find((item) => !triedTabsRef.current.has(item));
    if (nextTab) setTab(nextTab);
  }, [focusKey, data, tab, searchParams, setSearchParams]);

  async function recalculateEstimates() {
    setBusy("recalculate");
    setError("");
    try {
      const response = await api.recalculateDentistQueueEstimates();
      setSuccess(response.message || "Estimates recalculated.");
      await load();
    } catch (recalcError) {
      setError(recalcError.message);
    } finally {
      setBusy("");
    }
  }

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

  function openAddProcedure(entry) {
    setSelectedId(entry.id);
    setPendingAdd(entry);
    setProcedureDrafts([emptyProcedureDraft()]);
    setActiveDraftIndex(0);
    setAddError("");
    setProcedureErrors({});
    setError("");
    setSuccess("");
  }

  function closeAddProcedure() {
    if (busy.startsWith("add-")) return;
    setPendingAdd(null);
    setProcedureDrafts([emptyProcedureDraft()]);
    setActiveDraftIndex(0);
    setAddError("");
    setProcedureErrors({});
  }

  function updateProcedureDraft(index, patch) {
    setProcedureDrafts((current) =>
      current.map((draft, draftIndex) => (draftIndex === index ? { ...draft, ...patch } : draft))
    );
  }

  function validateDraft(draft, index) {
    if (!draft.name) return "Select a treatment type.";
    if (procedureRequiresTooth(draft.name) && !parseToothList(draft.toothNumber).length) {
      return `Tooth is required for ${draft.name}. Click it on the dental chart.`;
    }
    if (draft.amountCharged !== "" && !Number.isFinite(Number(draft.amountCharged))) {
      return "Enter a valid amount.";
    }
    if (draft.durationMinutes !== "" && !(Number(draft.durationMinutes) > 0)) {
      return "Enter a valid duration in minutes.";
    }
    return "";
  }

  async function submitAddProcedure(event) {
    event.preventDefault();
    if (!pendingAdd) return;
    const errors = {};
    procedureDrafts.forEach((draft, index) => {
      const message = validateDraft(draft, index);
      if (message) errors[index] = message;
    });
    if (Object.keys(errors).length) {
      setProcedureErrors(errors);
      setAddError("Complete every procedure before saving.");
      return;
    }

    setBusy(`add-${pendingAdd.id}`);
    setAddError("");
    setProcedureErrors({});
    setError("");
    setSuccess("");
    try {
      const response = await api.addDentistQueueProcedure(pendingAdd.id, {
        procedures: procedureDrafts.map((draft) => ({
          name: draft.name,
          treatment: draft.name,
          diagnosisNotes: draft.diagnosisNotes,
          diagnosis: draft.diagnosisNotes,
          toothNumber: draft.toothNumber || undefined,
          amountCharged: draft.amountCharged === "" ? 0 : Number(draft.amountCharged),
          durationMinutes: Number(draft.durationMinutes) > 0 ? Number(draft.durationMinutes) : undefined,
          treatmentDate: draft.treatmentDate || clinicTodayIso(),
        })),
      });
      setSuccess(response.message || "Procedures saved for this visit.");
      setPendingAdd(null);
      setProcedureDrafts([emptyProcedureDraft()]);
      await load({ silent: true });
    } catch (addProcError) {
      setAddError(addProcError.message);
    } finally {
      setBusy("");
    }
  }

  function openStartTreatment(entry) {
    setSelectedId(entry.id);
    const planned = (entry.procedures || []).filter(
      (procedure) => procedureStatusKey(procedure.status) !== "completed"
    );
    if (!planned.length) {
      openAddProcedure(entry);
      setError("Add at least one procedure before starting ongoing treatment.");
      return;
    }
    setPendingStart(entry);
    setError("");
    setSuccess("");
  }

  async function submitStartTreatment(event) {
    event.preventDefault();
    if (!pendingStart) return;
    setBusy(`start-${pendingStart.id}`);
    setError("");
    setSuccess("");
    try {
      const response = await api.startDentistTreatment(pendingStart.id, {});
      setSuccess(
        response.message ||
          `${pendingStart.patientName}'s ongoing treatment started. All planned procedures are on this visit.`
      );
      setPendingStart(null);
      setTab("ongoing");
      setData(await api.getDentistQueue("ongoing"));
    } catch (startError) {
      setError(startError.message);
    } finally {
      setBusy("");
    }
  }

  function openEditProcedure(entry, procedure) {
    setPendingEdit({ entry, procedure });
    setEditForm({
      ...emptyProcedureDraft(),
      name: procedure.name || procedure.treatment || "",
      diagnosisNotes: procedure.diagnosis || procedure.diagnosisNotes || "",
      toothNumber: procedure.toothNumber || "",
      amountCharged:
        procedure.amountCharged == null || procedure.amountCharged === ""
          ? ""
          : String(procedure.amountCharged),
      durationMinutes: procedure.durationMinutes ? String(procedure.durationMinutes) : "",
    });
    setEditError("");
  }

  async function submitEditProcedure(event) {
    event.preventDefault();
    if (!pendingEdit) return;
    const recordId = pendingEdit.entry.clinicalRecordId;
    if (!recordId) {
      setEditError("This patient record is not available yet.");
      return;
    }
    const message = validateDraft(editForm, 0);
    if (message) {
      setEditError(message);
      return;
    }
    setBusy(`edit-${pendingEdit.procedure.id}`);
    setEditError("");
    try {
      await api.updateDentistTreatment(recordId, pendingEdit.procedure.id, {
        name: editForm.name,
        treatment: editForm.name,
        diagnosisNotes: editForm.diagnosisNotes,
        diagnosis: editForm.diagnosisNotes,
        toothNumber: editForm.toothNumber || undefined,
        amountCharged: editForm.amountCharged === "" ? 0 : Number(editForm.amountCharged),
        durationMinutes: Number(editForm.durationMinutes) > 0 ? Number(editForm.durationMinutes) : undefined,
      });
      setSuccess(`${editForm.name} updated.`);
      setPendingEdit(null);
      await load({ silent: true });
    } catch (editProcError) {
      setEditError(editProcError.message);
    } finally {
      setBusy("");
    }
  }

  async function confirmRemoveProcedure() {
    if (!pendingRemove) return;
    const recordId = pendingRemove.entry.clinicalRecordId;
    if (!recordId) {
      setError("This patient record is not available yet.");
      return;
    }
    setBusy(`remove-${pendingRemove.procedure.id}`);
    setError("");
    try {
      await api.deleteDentistTreatment(recordId, pendingRemove.procedure.id);
      setSuccess("Planned procedure removed.");
      setPendingRemove(null);
      await load({ silent: true });
    } catch (removeError) {
      setError(removeError.message);
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
  const selectedEntry = queue.find((entry) => String(entry.id) === String(selectedId)) || null;

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
              className="button button--secondary"
              onClick={recalculateEstimates}
              disabled={Boolean(busy)}
            >
              Recalculate Estimates
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

      {selectedEntry ? (
        <section className="dentist-panel queue-visit-details">
          <div className="dentist-panel__heading">
            <div>
              <span className="eyebrow">{selectedEntry.token || `A${String(selectedEntry.sequence).padStart(3, "0")}`}</span>
              <h2>{selectedEntry.patientName}</h2>
              <p>
                Status: {selectedEntry.status === "in_chair" ? "In Treatment" : selectedEntry.status === "called" ? "Called" : "Waiting"}
                {selectedEntry.patientId ? ` · Patient ID ${selectedEntry.patientId}` : ""}
              </p>
            </div>
          </div>
          {selectedEntry.status === "in_chair" && currentVisitProcedure(selectedEntry) ? (
            <div className="procedure-draft-summary">
              <strong>Current procedure</strong>
              <p>
                {procedureLine(currentVisitProcedure(selectedEntry))} ·{" "}
                {procedureStatusLabel(currentVisitProcedure(selectedEntry).status)}
              </p>
              {plannedVisitProcedures(selectedEntry).length ? (
                <>
                  <strong>Upcoming procedures</strong>
                  <ul>
                    {plannedVisitProcedures(selectedEntry).map((procedure) => (
                      <li key={procedure.id}>
                        {procedureLine(procedure)} · {procedureStatusLabel(procedure.status)}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : (
            <div className="procedure-draft-summary">
              <strong>Planned procedures</strong>
              {selectedEntry.procedures?.length ? (
                <>
                  <ol className="visit-procedure-list">
                    {selectedEntry.procedures.map((procedure, index) => (
                      <li key={procedure.id || index}>
                        <div>
                          <strong>
                            {index + 1}. {procedureLine(procedure)}
                          </strong>
                          <span>Diagnosis: {procedure.diagnosis || "—"}</span>
                          <span>Amount: {formatMoney(procedure.amountCharged)}</span>
                          <span>Status: {procedureStatusLabel(procedure.status) || "Pending"}</span>
                        </div>
                        {isPlannedStatus(procedure.status) || selectedEntry.status !== "in_chair" ? (
                          <div className="dentist-row-actions">
                            <button
                              type="button"
                              className="button button--secondary button--compact"
                              disabled={Boolean(busy)}
                              onClick={() => openEditProcedure(selectedEntry, procedure)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="button button--secondary button--compact"
                              disabled={Boolean(busy)}
                              onClick={() => setPendingRemove({ entry: selectedEntry, procedure })}
                            >
                              Remove
                            </button>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                  <span>
                    Total procedures: {selectedEntry.procedures.length}
                    {" · Estimated visit duration: "}
                    {formatDurationMinutes(visitDurationMinutes(selectedEntry))}
                  </span>
                </>
              ) : (
                <p>No procedures added yet</p>
              )}
            </div>
          )}
          <div className="dentist-row-actions">
            {selectedEntry.status !== "completed" && selectedEntry.status !== "no_show" ? (
              <button
                type="button"
                className="button button--secondary"
                disabled={Boolean(busy)}
                onClick={() => openAddProcedure(selectedEntry)}
              >
                + Add Procedure
              </button>
            ) : null}
            {selectedEntry.status === "in_chair" ? (
              <button
                type="button"
                className="button button--primary"
                disabled={Boolean(busy)}
                onClick={() => openComplete(selectedEntry)}
              >
                Complete Treatment
              </button>
            ) : selectedEntry.status !== "completed" && selectedEntry.status !== "no_show" ? (
              <button
                type="button"
                className="button button--primary"
                disabled={Boolean(busy)}
                onClick={() => openStartTreatment(selectedEntry)}
              >
                Start Ongoing Treatment
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="dentist-panel dentist-panel--table">
        <div className="dentist-panel__heading">
          <div>
            <span className="eyebrow">Treatment priority stream</span>
            <h2>Patient Queue</h2>
            <p>{QUEUE_WAIT_DISCLAIMER}</p>
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
                  <th>Est. Duration</th>
                  <th>Est. Wait</th>
                  <th>Est. Call</th>
                  <th>Status Check</th>
                  <th>Operational Control</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((entry) => (
                  <tr
                    key={entry.id}
                    ref={
                      matchesNotificationFocus(entry, focusKey, ["id", "token", "sequence", "appointmentId"])
                        ? focusedRowRef
                        : null
                    }
                    className={
                      [
                        matchesNotificationFocus(entry, focusKey, ["id", "token", "sequence", "appointmentId"])
                          ? "is-notification-focus"
                          : "",
                        String(selectedId) === String(entry.id) ? "is-queue-selected" : "",
                      ]
                        .filter(Boolean)
                        .join(" ") || undefined
                    }
                    onClick={() => setSelectedId(entry.id)}
                  >
                    <td>
                      <strong>#{String(entry.sequence).padStart(2, "0")}</strong>
                    </td>
                    <td>
                      <strong>{entry.patientName}</strong>
                      <small>{entry.patientPhone || entry.token || "Checked in"}</small>
                    </td>
                    <td>
                      <QueueProcedureList entry={entry} />
                    </td>
                    <td>
                      {formatDurationMinutes(visitDurationMinutes(entry)) !== "—"
                        ? formatDurationMinutes(visitDurationMinutes(entry))
                        : durationFromEntry(entry)}
                    </td>
                    <td>
                      <strong>{formatWaitLabel(entry)}</strong>
                    </td>
                    <td>
                      {entry.status === "in_chair"
                        ? "Now"
                        : entry.status === "completed" || entry.status === "no_show"
                          ? "—"
                          : callRangeFromEntry(entry)}
                    </td>
                    <td>
                      <DentistStatusBadge status={entry.status} />
                    </td>
                    <td>
                      <div className="dentist-row-actions">
                        {entry.status !== "completed" && entry.status !== "no_show" ? (
                          <button
                            type="button"
                            className="button button--secondary button--compact"
                            disabled={Boolean(busy)}
                            onClick={(event) => {
                              event.stopPropagation();
                              openAddProcedure(entry);
                            }}
                          >
                            {busy === `add-${entry.id}` ? "Saving…" : "+ Add Procedure"}
                          </button>
                        ) : null}
                        {entry.status === "in_chair" ? (
                          <button
                            type="button"
                            className="button button--primary button--compact"
                            disabled={Boolean(busy)}
                            onClick={(event) => {
                              event.stopPropagation();
                              openComplete(entry);
                            }}
                          >
                            {busy === `complete-${entry.id}` ? "Saving…" : "Complete Treatment"}
                          </button>
                        ) : null}
                        {entry.status === "in_chair" ? (
                          <button
                            type="button"
                            className="button button--secondary button--compact"
                            disabled={Boolean(busy)}
                            onClick={(event) => {
                              event.stopPropagation();
                              setWaiting(entry);
                            }}
                          >
                            Return to Waiting
                          </button>
                        ) : null}
                        {entry.status !== "completed" &&
                        entry.status !== "no_show" &&
                        entry.status !== "in_chair" ? (
                          <button
                            type="button"
                            className="button button--primary button--compact"
                            disabled={Boolean(busy)}
                            onClick={(event) => {
                              event.stopPropagation();
                              openStartTreatment(entry);
                            }}
                          >
                            Start Ongoing Treatment
                          </button>
                        ) : null}
                        {entry.status !== "completed" &&
                        entry.status !== "no_show" &&
                        entry.status !== "in_chair" &&
                        entry.status !== "called" ? (
                          <button
                            type="button"
                            className="button button--secondary button--compact"
                            disabled={Boolean(busy)}
                            onClick={(event) => {
                              event.stopPropagation();
                              markCalled(entry);
                            }}
                          >
                            Call patient
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
          title="Start Ongoing Treatment"
          wide
          onClose={() => {
            if (!busy) setPendingStart(null);
          }}
        >
          <form className="dentist-form" onSubmit={submitStartTreatment}>
            <p className="dentist-confirm-copy">
              Start treatment for <strong>{pendingStart.patientName}</strong> on queue{" "}
              <strong>{pendingStart.token || pendingStart.sequence}</strong>. The patient stays on this
              same visit. The first procedure becomes In Treatment and the rest stay Pending.
            </p>
            <div className="procedure-draft-summary">
              <strong>Procedures that will start together</strong>
              <ol className="visit-procedure-list">
                {(pendingStart.procedures || []).map((procedure, index) => (
                  <li key={procedure.id || index}>
                    <strong>
                      {index + 1}. {procedureLine(procedure)}
                    </strong>
                    <span>{index === 0 ? "Will become In Treatment" : "Will remain Pending"}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="dentist-modal__actions">
              <button
                type="button"
                className="button button--secondary"
                disabled={Boolean(busy)}
                onClick={() => setPendingStart(null)}
              >
                Cancel
              </button>
              <button type="submit" className="button button--primary" disabled={Boolean(busy)}>
                {busy.startsWith("start-") ? "Starting…" : "Start Ongoing Treatment"}
              </button>
            </div>
          </form>
        </DentistModal>
      ) : null}

      {pendingAdd ? (
        <DentistModal title="Add Procedures" wide stacked onClose={closeAddProcedure}>
          <form className="dentist-form" onSubmit={submitAddProcedure}>
            <p className="dentist-confirm-copy">
              Prepare procedures for <strong>{pendingAdd.patientName}</strong> on queue{" "}
              <strong>{pendingAdd.token || pendingAdd.sequence}</strong>
              {pendingAdd.status === "in_chair"
                ? ". New procedures are added to this same visit without replacing the current treatment."
                : ". Saving procedures does not start treatment or change Waiting status."}
            </p>
            {pendingAdd.procedures?.length ? (
              <div className="procedure-draft-summary">
                <strong>Already on this visit</strong>
                <ul>
                  {pendingAdd.procedures.map((procedure) => (
                    <li key={procedure.id || procedureLine(procedure)}>
                      {procedureLine(procedure)} — {procedureStatusLabel(procedure.status) || "—"}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {addError ? <p className="inline-alert inline-alert--error">{addError}</p> : null}
            {procedureDrafts.map((draft, index) => (
              <section
                key={draft.key}
                className={`procedure-draft ${activeDraftIndex === index ? "is-active" : ""}`}
                onClick={() => setActiveDraftIndex(index)}
              >
                <div className="procedure-draft__header">
                  <strong>
                    Procedure {index + 1}
                    {draft.name ? ` · ${draft.name}` : ""}
                    {parseToothList(draft.toothNumber).length
                      ? ` · #${parseToothList(draft.toothNumber).join(", #")}`
                      : ""}
                  </strong>
                  {procedureDrafts.length > 1 ? (
                    <button
                      type="button"
                      className="button button--secondary button--compact"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setProcedureDrafts((current) => current.filter((_, draftIndex) => draftIndex !== index));
                        setActiveDraftIndex((current) => Math.max(0, Math.min(current, procedureDrafts.length - 2)));
                      }}
                      disabled={busy.startsWith("add-")}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
                <ProcedureFields
                  draft={draft}
                  requiredTooth={procedureRequiresTooth(draft.name)}
                  onChange={(patch) => {
                    setActiveDraftIndex(index);
                    updateProcedureDraft(index, patch);
                  }}
                />
                {procedureErrors[index] ? (
                  <p className="inline-alert inline-alert--error">{procedureErrors[index]}</p>
                ) : null}
              </section>
            ))}
            <button
              type="button"
              className="button button--secondary"
              onClick={(event) => {
                event.preventDefault();
                setProcedureDrafts((current) => {
                  setActiveDraftIndex(current.length);
                  return [...current, emptyProcedureDraft()];
                });
              }}
              disabled={busy.startsWith("add-")}
            >
              + Add Another Procedure
            </button>
            {pendingAdd.clinicalRecordId ? (
              <DentalChart
                patientId={pendingAdd.clinicalRecordId}
                pickMode
                selectedTeeth={parseToothList(procedureDrafts[activeDraftIndex]?.toothNumber)}
                onTeethChange={(teeth) =>
                  updateProcedureDraft(activeDraftIndex, { toothNumber: teeth.join(", ") })
                }
              />
            ) : (
              <p className="muted-copy">Select the affected tooth in the Tooth Number field if needed.</p>
            )}
            <div className="dentist-modal__actions">
              <button
                type="button"
                className="button button--secondary"
                disabled={busy.startsWith("add-")}
                onClick={closeAddProcedure}
              >
                Cancel
              </button>
              <button type="submit" className="button button--primary" disabled={busy.startsWith("add-")}>
                {busy.startsWith("add-") ? "Saving Procedures…" : "Save Procedures"}
              </button>
            </div>
          </form>
        </DentistModal>
      ) : null}

      {pendingEdit ? (
        <DentistModal
          title="Edit planned procedure"
          wide
          stacked
          onClose={() => {
            if (!busy.startsWith("edit-")) setPendingEdit(null);
          }}
        >
          <form className="dentist-form" onSubmit={submitEditProcedure}>
            {editError ? <p className="inline-alert inline-alert--error">{editError}</p> : null}
            <ProcedureFields
              draft={editForm}
              requiredTooth={procedureRequiresTooth(editForm.name)}
              onChange={(patch) => setEditForm((current) => ({ ...current, ...patch }))}
            />
            {pendingEdit.entry.clinicalRecordId ? (
              <DentalChart
                patientId={pendingEdit.entry.clinicalRecordId}
                pickMode
                selectedTeeth={parseToothList(editForm.toothNumber)}
                onTeethChange={(teeth) =>
                  setEditForm((current) => ({ ...current, toothNumber: teeth.join(", ") }))
                }
              />
            ) : null}
            <div className="dentist-modal__actions">
              <button
                type="button"
                className="button button--secondary"
                disabled={busy.startsWith("edit-")}
                onClick={() => setPendingEdit(null)}
              >
                Cancel
              </button>
              <button type="submit" className="button button--primary" disabled={busy.startsWith("edit-")}>
                {busy.startsWith("edit-") ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </form>
        </DentistModal>
      ) : null}

      {pendingRemove ? (
        <DentistModal title="Remove planned procedure?" onClose={() => setPendingRemove(null)}>
          <p className="dentist-confirm-copy">
            Remove {procedureLine(pendingRemove.procedure)} from {pendingRemove.entry.patientName}&apos;s
            planned visit? Queue number {pendingRemove.entry.token || pendingRemove.entry.sequence} stays
            the same.
          </p>
          <div className="dentist-modal__actions">
            <button type="button" className="button button--secondary" onClick={() => setPendingRemove(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={confirmRemoveProcedure}
              disabled={Boolean(busy)}
            >
              {busy.startsWith("remove-") ? "Removing…" : "Remove"}
            </button>
          </div>
        </DentistModal>
      ) : null}

      {pendingComplete ? (
        <DentistModal title="Mark treatment Done?" onClose={() => setPendingComplete(null)}>
          <p className="dentist-confirm-copy">
            Mark {pendingComplete.patientName}&apos;s{" "}
            {procedureLine(pendingComplete.currentProcedure) || pendingComplete.procedure} as Done?
            {pendingComplete.procedures?.filter((procedure) =>
              ["planned", "pending"].includes(String(procedure.status || "").toLowerCase())
            ).length
              ? " Additional procedures are still pending, so this visit stays in treatment."
              : " This finalizes the visit and frees the chair for the next patient."}
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
