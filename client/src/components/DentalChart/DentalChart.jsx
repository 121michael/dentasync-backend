import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { ErrorState, LoadingState } from "../UI";
import { Tooth } from "./Tooth";
import { ToothDetailsPanel } from "./ToothDetailsPanel";
import {
  ALL_TEETH,
  LOWER_TEETH,
  UPPER_TEETH,
  buildDefaultChart,
  emptyToothRecord,
  labelFor,
  normalizeChartEntry,
  toothPositions,
  TREATMENT_OPTIONS,
} from "./dentalChartData";

const VIEW = { width: 760, height: 620 };

export function DentalChart({ patientId, dentistName, onTreatmentRecorded }) {
  const [chart, setChart] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [success, setSuccess] = useState("");
  const [selectedTooth, setSelectedTooth] = useState("");
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);

  async function loadChart() {
    if (!patientId) return;
    setLoadError("");
    try {
      const response = await api.getDentistDentalChart(patientId);
      const next = buildDefaultChart();
      for (const entry of response.entries || response.chart || []) {
        const normalized = normalizeChartEntry(entry);
        if (normalized.toothNumber) {
          next[normalized.toothNumber] = normalized;
        }
      }
      setChart(next);
    } catch (error) {
      setLoadError(error.message || "Unable to load dental chart.");
      setChart(null);
    }
  }

  useEffect(() => {
    setSelectedTooth("");
    setDraft(null);
    setSuccess("");
    setSaveError("");
    setChart(null);
    loadChart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  const upperPositions = useMemo(
    () =>
      toothPositions(UPPER_TEETH, {
        cx: VIEW.width / 2,
        cy: 195,
        rx: 268,
        ry: 118,
        invert: false,
        labelPad: 38,
      }),
    []
  );

  const lowerPositions = useMemo(
    () =>
      toothPositions(LOWER_TEETH, {
        cx: VIEW.width / 2,
        cy: 430,
        rx: 268,
        ry: 118,
        invert: true,
        labelPad: 38,
      }),
    []
  );

  function selectTooth(toothNumber) {
    const key = String(toothNumber);
    const record = chart?.[key] || emptyToothRecord(key);
    setSelectedTooth(key);
    setDraft({ ...record, condition: [...(record.condition || [])], treatments: [...(record.treatments || [])] });
    setSaveError("");
    setSuccess("");
  }

  function updateDraft(patch) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function toggleListValue(listName, value) {
    setDraft((current) => {
      if (!current) return current;
      const list = Array.isArray(current[listName]) ? [...current[listName]] : [];
      const index = list.indexOf(value);
      if (index >= 0) list.splice(index, 1);
      else list.push(value);
      const next = { ...current, [listName]: list };
      if (listName === "condition") {
        if (list.includes("missing")) next.status = "missing";
        next.conditionLabel = list[0] || "healthy";
      }
      return next;
    });
  }

  async function saveTooth() {
    if (!patientId || !selectedTooth || !draft) return;
    setBusy(true);
    setSaveError("");
    setSuccess("");
    try {
      const payload = {
        toothNumber: String(selectedTooth),
        status: draft.status || "healthy",
        conditions: draft.condition || [],
        conditionLabel: (draft.condition && draft.condition[0]) || draft.status || "healthy",
        treatments: draft.treatments || [],
        notes: draft.notes || "",
      };
      const response = await api.upsertDentistDentalChart(patientId, payload);
      const savedRaw = (response.entries || [])[0] || response.entry || payload;
      const saved = normalizeChartEntry({
        ...savedRaw,
        conditions: payload.conditions,
        treatments: payload.treatments,
        status: payload.status,
        notes: payload.notes,
        updatedBy: savedRaw.updatedBy || dentistName || savedRaw.createdBy,
      });

      setChart((current) => ({
        ...(current || buildDefaultChart()),
        [saved.toothNumber]: saved,
      }));
      setDraft(saved);
      setSuccess("Dental chart updated successfully.");

      // Mirror newly selected treatments into treatment history when supported.
      const previous = chart?.[selectedTooth]?.treatments || [];
      const added = (draft.treatments || []).filter((item) => !previous.includes(item));
      for (const treatment of added) {
        try {
          await api.addDentistTreatment(patientId, {
            treatment: labelFor(treatment, TREATMENT_OPTIONS),
            name: labelFor(treatment, TREATMENT_OPTIONS),
            toothNumber: String(selectedTooth),
            notes: draft.notes || "",
            status: draft.status === "under_treatment" ? "in_progress" : "completed",
          });
        } catch {
          // Chart save already succeeded; history mirror is best-effort.
        }
      }
      if (added.length && onTreatmentRecorded) {
        await onTreatmentRecorded();
      }
    } catch (error) {
      setSaveError(error.message || "Unable to save dental chart.");
    } finally {
      setBusy(false);
    }
  }

  if (loadError && !chart) {
    return (
      <section className="fdi-chart-shell glass-card">
        <ErrorState message={loadError} onRetry={loadChart} />
      </section>
    );
  }

  if (!chart) {
    return (
      <section className="fdi-chart-shell glass-card">
        <LoadingState label="Loading Dental Chart…" />
      </section>
    );
  }

  const recordedCount = ALL_TEETH.filter((tooth) => {
    const entry = chart[String(tooth)];
    return (
      entry &&
      ((entry.condition && entry.condition.length && !(entry.condition.length === 1 && entry.condition[0] === "healthy")) ||
        (entry.treatments && entry.treatments.length) ||
        (entry.notes && entry.notes.trim()) ||
        (entry.status && entry.status !== "healthy"))
    );
  }).length;

  return (
    <section className="fdi-chart-shell">
      <div className="fdi-chart-layout">
        <div className="fdi-chart-canvas glass-card">
          <div className="fdi-chart-canvas__head">
            <div>
              <span className="eyebrow">Interactive FDI chart</span>
              <h2>2D Dental Chart</h2>
              <p className="muted-copy">
                Manual clinical charting. Click a tooth to record status, condition, treatment, and notes.
              </p>
            </div>
            <small className="fdi-chart-count">
              {recordedCount ? `${recordedCount} teeth with notes` : "No dental chart information recorded."}
            </small>
          </div>

          {success ? <p className="inline-alert inline-alert--success">{success}</p> : null}

          <div className="fdi-chart-scroll">
            <svg
              className="fdi-chart-svg"
              viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
              role="img"
              aria-label="Interactive FDI dental chart with upper and lower arches"
            >
              <defs>
                <radialGradient id="fdiGingivaUpper" cx="50%" cy="62%" r="68%">
                  <stop offset="0%" stopColor="#fff8f7" />
                  <stop offset="55%" stopColor="#f7d4d0" />
                  <stop offset="100%" stopColor="#e8a8a0" />
                </radialGradient>
                <radialGradient id="fdiGingivaLower" cx="50%" cy="38%" r="68%">
                  <stop offset="0%" stopColor="#fff8f7" />
                  <stop offset="55%" stopColor="#f7d4d0" />
                  <stop offset="100%" stopColor="#e8a8a0" />
                </radialGradient>
                <radialGradient id="fdiOralCavity" cx="50%" cy="50%" r="55%">
                  <stop offset="0%" stopColor="#ffffff" />
                  <stop offset="70%" stopColor="#fff5f3" />
                  <stop offset="100%" stopColor="#f3cfc9" />
                </radialGradient>
                <linearGradient id="fdiToothIvory" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#fffdf8" />
                  <stop offset="45%" stopColor="#f7f0e4" />
                  <stop offset="100%" stopColor="#e8dcc8" />
                </linearGradient>
                <linearGradient id="fdiToothHighlight" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(255,255,255,0.55)" />
                  <stop offset="55%" stopColor="rgba(255,255,255,0)" />
                </linearGradient>
                <filter id="fdiSoftShadow" x="-40%" y="-40%" width="180%" height="180%">
                  <feDropShadow dx="0.6" dy="1.2" stdDeviation="1.1" floodColor="#8b5a4a" floodOpacity="0.22" />
                </filter>
              </defs>

              {/* Soft page wash */}
              <rect x="0" y="0" width={VIEW.width} height={VIEW.height} fill="#fbf7f4" rx="18" />

              {/* Upper gingival field */}
              <ellipse
                cx={VIEW.width / 2}
                cy={195}
                rx={300}
                ry={145}
                fill="url(#fdiGingivaUpper)"
                opacity="0.95"
              />
              {/* Lower gingival field */}
              <ellipse
                cx={VIEW.width / 2}
                cy={430}
                rx={300}
                ry={145}
                fill="url(#fdiGingivaLower)"
                opacity="0.95"
              />
              {/* Shared oral cavity / open center */}
              <ellipse
                cx={VIEW.width / 2}
                cy={312}
                rx={168}
                ry={92}
                fill="url(#fdiOralCavity)"
                stroke="rgba(196, 120, 110, 0.28)"
                strokeWidth="1.5"
              />

              <text className="fdi-arch-label" x={VIEW.width / 2} y={198} textAnchor="middle">
                UPPER
              </text>
              <text className="fdi-arch-label" x={VIEW.width / 2} y={434} textAnchor="middle">
                LOWER
              </text>

              {upperPositions.map((position) => (
                <Tooth
                  key={`u-${position.tooth}`}
                  toothNumber={position.tooth}
                  record={chart[String(position.tooth)]}
                  selected={String(selectedTooth) === String(position.tooth)}
                  onSelect={selectTooth}
                  x={position.x}
                  y={position.y}
                  rotate={position.rotate}
                  labelX={position.labelX}
                  labelY={position.labelY}
                  scale={position.scale}
                />
              ))}

              {lowerPositions.map((position) => (
                <Tooth
                  key={`l-${position.tooth}`}
                  toothNumber={position.tooth}
                  record={chart[String(position.tooth)]}
                  selected={String(selectedTooth) === String(position.tooth)}
                  onSelect={selectTooth}
                  x={position.x}
                  y={position.y}
                  rotate={position.rotate}
                  labelX={position.labelX}
                  labelY={position.labelY}
                  scale={position.scale}
                />
              ))}
            </svg>
          </div>

          <div className="fdi-legend">
            <span className="fdi-legend__item fdi-legend__item--healthy">Healthy</span>
            <span className="fdi-legend__item fdi-legend__item--decay">Decay / Attention</span>
            <span className="fdi-legend__item fdi-legend__item--treated">Treated</span>
            <span className="fdi-legend__item fdi-legend__item--under_treatment">Under Treatment</span>
            <span className="fdi-legend__item fdi-legend__item--missing">Missing</span>
          </div>
        </div>

        <ToothDetailsPanel
          toothNumber={selectedTooth}
          draft={draft}
          busy={busy}
          error={saveError}
          onChange={updateDraft}
          onToggleCondition={(value) => toggleListValue("condition", value)}
          onToggleTreatment={(value) => toggleListValue("treatments", value)}
          onSave={saveTooth}
          onCancel={() => {
            setSelectedTooth("");
            setDraft(null);
            setSaveError("");
          }}
        />
      </div>
    </section>
  );
}
