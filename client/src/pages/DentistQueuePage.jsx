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
      <label className="field field--full">
        <span>Diagnosis</span>
        <textarea
          rows="2"
          value={draft.diagnosisNotes}
          onChange={(event) => onChange({ diagnosisNotes: event.target.value })}
          placeholder="e.g. Dental Caries"
        />
      </label>
      <label className="field">
        <span>Treatment</span>
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
        <span>Treatment Date</span>
        <input type="date" value={draft.treatmentDate} readOnly />
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
    </div>
  );
}

function formatElapsed(fromIso) {
  const start = new Date(fromIso).getTime();
  if (!Number.isFinite(start)) return "00:00:00";
  const total = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const hours = String(Math.floor(total / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function TreatmentTimer({ startedAt }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!startedAt) return undefined;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return <strong className="queue-treatment-timer">{formatElapsed(startedAt)}</strong>;
}

function statusLabel(status) {
  if (status === "in_chair") return "In Treatment";
  if (status === "called") return "Called";
  if (status === "completed") return "Completed";
  return "Waiting";
}

function draftPayload(draft) {
  return {
    name: draft.name,
    treatment: draft.name,
    diagnosisNotes: draft.diagnosisNotes,
    diagnosis: draft.diagnosisNotes,
    toothNumber: draft.toothNumber || undefined,
    amountCharged: draft.amountCharged === "" ? 0 : Number(draft.amountCharged),
    durationMinutes: Number(draft.durationMinutes) > 0 ? Number(draft.durationMinutes) : undefined,
    treatmentDate: draft.treatmentDate || clinicTodayIso(),
  };
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
  const [treatmentEntryId, setTreatmentEntryId] = useState(null);
  const [procedureDrafts, setProcedureDrafts] = useState(() => [emptyProcedureDraft()]);
  const [activeDraftIndex, setActiveDraftIndex] = useState(0);
  const [procedureErrors, setProcedureErrors] = useState({});
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
      const entry = response.queueEntry;
      setSuccess(response.message || "Next patient called. Fill out the treatment form, then press Start Treatment.");
      setTreatmentEntryId(entry?.id || null);
      setProcedureDrafts([emptyProcedureDraft()]);
      setActiveDraftIndex(0);
      setProcedureErrors({});
      setTab("ongoing");
      setData(await api.getDentistQueue("ongoing", { silent: true }));
    } catch (callError) {
      setError(callError.message);
    } finally {
      setBusy("");
    }
  }

  function openTreatment(entry) {
    if (entry.status !== "called" && entry.status !== "in_chair") return;
    setTreatmentEntryId(entry.id);
    setError("");
    setProcedureErrors({});
    if (entry.status === "in_chair") {
      setProcedureDrafts([]);
      setActiveDraftIndex(0);
    } else {
      setProcedureDrafts([emptyProcedureDraft()]);
      setActiveDraftIndex(0);
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
      const extras = procedureDrafts.filter((draft) => draft.name);
      if (extras.length) {
        const errors = {};
        extras.forEach((draft, index) => {
          const message = validateDraft(draft);
          if (message) errors[index] = message;
        });
        if (Object.keys(errors).length) {
          setProcedureErrors(errors);
          setError("Complete additional treatments before saving.");
          return;
        }
        await api.addDentistQueueProcedure(pendingComplete.id, {
          procedures: extras.map(draftPayload),
        });
      }
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
      setProcedureDrafts([]);
      if (response.visitComplete !== false) {
        setTreatmentEntryId(null);
      }
      await load({ silent: true });
    } catch (completeError) {
      setError(completeError.message);
    } finally {
      setBusy("");
    }
  }

  function updateProcedureDraft(index, patch) {
    setProcedureDrafts((current) =>
      current.map((draft, draftIndex) => (draftIndex === index ? { ...draft, ...patch } : draft))
    );
  }

  function validateDraft(draft) {
    if (!draft.name) return "Select a treatment.";
    if (procedureRequiresTooth(draft.name) && !parseToothList(draft.toothNumber).length) {
      return `Tooth is required for ${draft.name}. Click it on the dental chart.`;
    }
    if (draft.amountCharged !== "" && !Number.isFinite(Number(draft.amountCharged))) {
      return "Enter a valid amount.";
    }
    return "";
  }

  function addTreatmentSection() {
    if (treatmentEntry?.status === "in_chair") {
      const ready = procedureDrafts.filter((draft) => draft.name && !validateDraft(draft));
      if (ready.length) {
        api
          .addDentistQueueProcedure(treatmentEntry.id, { procedures: ready.map(draftPayload) })
          .then(() => load({ silent: true }))
          .catch((addError) => setError(addError.message));
        setProcedureDrafts([emptyProcedureDraft()]);
        setActiveDraftIndex(0);
        setProcedureErrors({});
        return;
      }
    }
    setProcedureDrafts((current) => {
      const next = current.length ? [...current, emptyProcedureDraft()] : [emptyProcedureDraft()];
      setActiveDraftIndex(next.length - 1);
      return next;
    });
    setProcedureErrors({});
  }

  async function startTreatment(entry) {
    const errors = {};
    procedureDrafts.forEach((draft, index) => {
      const message = validateDraft(draft);
      if (message) errors[index] = message;
    });
    if (!procedureDrafts.length || Object.keys(errors).length) {
      setProcedureErrors(errors);
      setError("Complete every procedure before starting treatment.");
      return;
    }
    setBusy(`start-${entry.id}`);
    setError("");
    setSuccess("");
    try {
      const response = await api.startDentistTreatment(entry.id, {
        procedures: procedureDrafts.map(draftPayload),
      });
      setSuccess(response.message || "Treatment started.");
      setProcedureDrafts([]);
      setProcedureErrors({});
      setTab("ongoing");
      setData(await api.getDentistQueue("ongoing", { silent: true }));
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
      setTreatmentEntryId(entry.id);
      setProcedureDrafts([emptyProcedureDraft()]);
      setActiveDraftIndex(0);
      setTab("ongoing");
      setData(await api.getDentistQueue("ongoing", { silent: true }));
    } catch (callError) {
      setError(callError.message);
    } finally {
      setBusy("");
    }
  }

  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading live patient treatment queue…" />;

  const queue = data.queue || [];
  const treatmentEntry = queue.find((entry) => String(entry.id) === String(treatmentEntryId)) || null;

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

      {treatmentEntry && treatmentEntry.status !== "completed" && treatmentEntry.status !== "no_show" ? (
        <section className="dentist-panel queue-visit-details">
          <div className="dentist-panel__heading">
            <div>
              <span className="eyebrow">Patient</span>
              <h2>{treatmentEntry.patientName}</h2>
              <p>
                Queue: {treatmentEntry.token || `#${String(treatmentEntry.sequence).padStart(3, "0")}`}
                {treatmentEntry.recordCode ? ` · Patient ID: ${treatmentEntry.recordCode}` : ""}
                {" · Status: "}
                {statusLabel(treatmentEntry.status)}
              </p>
            </div>
          </div>

          {treatmentEntry.status === "in_chair" ? (
            <div className="procedure-draft-summary">
              <strong>Ongoing treatment</strong>
              {treatmentEntry.servingStartedAt ? (
                <p>
                  Treatment timer <TreatmentTimer startedAt={treatmentEntry.servingStartedAt} />
                </p>
              ) : null}
              {currentVisitProcedure(treatmentEntry) ? (
                <p>
                  Current procedure: {procedureLine(currentVisitProcedure(treatmentEntry))} · In Treatment
                </p>
              ) : null}
              {plannedVisitProcedures(treatmentEntry).length ? (
                <>
                  <strong>Pending procedures</strong>
                  <ul>
                    {plannedVisitProcedures(treatmentEntry).map((procedure) => (
                      <li key={procedure.id}>
                        {procedureLine(procedure)} · Pending
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : (
            <p className="muted-copy">
              Fill out the first treatment below. Use + Add Treatment for more procedures on this same
              visit. Start Treatment begins the timer.
            </p>
          )}

          {procedureDrafts.map((draft, index) => (
            <section
              key={draft.key}
              className={`procedure-draft ${activeDraftIndex === index ? "is-active" : ""}`}
              onClick={() => setActiveDraftIndex(index)}
            >
              <div className="procedure-draft__header">
                <strong>
                  Procedure{" "}
                  {(treatmentEntry.procedures?.length || 0) + index + 1}
                  {draft.name ? ` · ${draft.name}` : ""}
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
                    disabled={Boolean(busy)}
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

          {treatmentEntry.clinicalRecordId && procedureDrafts.length ? (
            <DentalChart
              patientId={treatmentEntry.clinicalRecordId}
              pickMode
              selectedTeeth={parseToothList(procedureDrafts[activeDraftIndex]?.toothNumber)}
              onTeethChange={(teeth) =>
                updateProcedureDraft(activeDraftIndex, { toothNumber: teeth.join(", ") })
              }
            />
          ) : null}

          <div className="dentist-row-actions">
            <button
              type="button"
              className="button button--secondary"
              disabled={Boolean(busy)}
              onClick={addTreatmentSection}
            >
              + Add Treatment
            </button>
            {treatmentEntry.status === "in_chair" ? (
              <button
                type="button"
                className="button button--primary"
                disabled={Boolean(busy)}
                onClick={() => openComplete(treatmentEntry)}
              >
                {busy.startsWith("complete-") ? "Saving…" : "Done & Save"}
              </button>
            ) : (
              <button
                type="button"
                className="button button--primary"
                disabled={Boolean(busy)}
                onClick={() => startTreatment(treatmentEntry)}
              >
                {busy.startsWith("start-") ? "Starting…" : "Start Treatment"}
              </button>
            )}
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
                        String(treatmentEntryId) === String(entry.id) ? "is-queue-selected" : "",
                      ]
                        .filter(Boolean)
                        .join(" ") || undefined
                    }
                    onClick={() => {
                      if (entry.status === "called" || entry.status === "in_chair") openTreatment(entry);
                    }}
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
                        {entry.status === "called" || entry.status === "in_chair" ? (
                          <button
                            type="button"
                            className="button button--secondary button--compact"
                            disabled={Boolean(busy)}
                            onClick={(event) => {
                              event.stopPropagation();
                              openTreatment(entry);
                            }}
                          >
                            Open treatment
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
                            {busy === `complete-${entry.id}` ? "Saving…" : "Done & Save"}
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
              {busy.startsWith("complete-") ? "Saving…" : "Done & Save"}
            </button>
          </div>
        </DentistModal>
      ) : null}
    </div>
  );
}
