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
import { gumArchStrokePath } from "./mouthShapes";

const VIEW = { width: 900, height: 760 };

// Near-circular horseshoe so chord spacing matches crown widths evenly.
const UPPER_ARCH = { cx: VIEW.width / 2, cy: 235, rx: 255, ry: 175 };
const LOWER_ARCH = { cx: VIEW.width / 2, cy: 535, rx: 255, ry: 175 };

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
        ...UPPER_ARCH,
        invert: false,
        labelPad: 52,
      }),
    []
  );

  const lowerPositions = useMemo(
    () =>
      toothPositions(LOWER_TEETH, {
        ...LOWER_ARCH,
        invert: true,
        labelPad: 52,
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
                <linearGradient id="fdiToothIvory" x1="0.2" y1="0.05" x2="0.85" y2="0.95">
                  <stop offset="0%" stopColor="#fffcf6" />
                  <stop offset="35%" stopColor="#f5ecdc" />
                  <stop offset="75%" stopColor="#e6d7bc" />
                  <stop offset="100%" stopColor="#d4c19e" />
                </linearGradient>
                <radialGradient id="fdiToothCusp" cx="40%" cy="35%" r="65%">
                  <stop offset="0%" stopColor="rgba(255,255,255,0.75)" />
                  <stop offset="55%" stopColor="rgba(255,248,235,0.18)" />
                  <stop offset="100%" stopColor="rgba(220,200,160,0)" />
                </radialGradient>
                <linearGradient id="fdiToothHighlight" x1="0" y1="0" x2="0.25" y2="1">
                  <stop offset="0%" stopColor="rgba(255,255,255,0.55)" />
                  <stop offset="45%" stopColor="rgba(255,255,255,0.08)" />
                  <stop offset="100%" stopColor="rgba(255,255,255,0)" />
                </linearGradient>
                <linearGradient id="fdiToothShade" x1="0.5" y1="0" x2="0.5" y2="1">
                  <stop offset="0%" stopColor="rgba(170,140,100,0.04)" />
                  <stop offset="100%" stopColor="rgba(140,110,75,0.14)" />
                </linearGradient>
                <filter id="fdiGumBlur" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="9" />
                </filter>
                <filter id="fdiSoftShadow" x="-25%" y="-25%" width="150%" height="150%">
                  <feDropShadow dx="0.2" dy="0.45" stdDeviation="0.45" floodColor="#8b5a4a" floodOpacity="0.14" />
                </filter>
              </defs>

              <rect x="0" y="0" width={VIEW.width} height={VIEW.height} fill="#ffffff" />

              {/* Soft pink gum halo along the full arch (reference style) */}
              <g className="fdi-mouth" aria-hidden="true">
                <path
                  d={gumArchStrokePath({ ...UPPER_ARCH, invert: false })}
                  fill="none"
                  stroke="rgba(230, 115, 105, 0.55)"
                  strokeWidth="52"
                  strokeLinecap="round"
                  filter="url(#fdiGumBlur)"
                />
                <path
                  d={gumArchStrokePath({ ...LOWER_ARCH, invert: true })}
                  fill="none"
                  stroke="rgba(230, 115, 105, 0.55)"
                  strokeWidth="52"
                  strokeLinecap="round"
                  filter="url(#fdiGumBlur)"
                />
              </g>

              <text className="fdi-arch-label" x={VIEW.width / 2} y={238} textAnchor="middle">
                UPPER
              </text>
              <text className="fdi-arch-label" x={VIEW.width / 2} y={538} textAnchor="middle">
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
