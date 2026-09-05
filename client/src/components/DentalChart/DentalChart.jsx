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
import { horseshoeBandPath, palatePath, tonguePath, vestibulePath } from "./mouthShapes";

const VIEW = { width: 1040, height: 840 };

const UPPER_ARCH = { cx: VIEW.width / 2, cy: 255, rx: 312, ry: 138 };
const LOWER_ARCH = { cx: VIEW.width / 2, cy: 590, rx: 312, ry: 138 };

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
        labelPad: 90,
      }),
    []
  );

  const lowerPositions = useMemo(
    () =>
      toothPositions(LOWER_TEETH, {
        ...LOWER_ARCH,
        invert: true,
        labelPad: 90,
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
                <linearGradient id="fdiPageWash" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#faf6f2" />
                  <stop offset="100%" stopColor="#f3ebe4" />
                </linearGradient>
                <radialGradient id="fdiGingivaBand" cx="50%" cy="45%" r="72%">
                  <stop offset="0%" stopColor="#fce8e3" />
                  <stop offset="45%" stopColor="#f0c4bb" />
                  <stop offset="100%" stopColor="#d99288" />
                </radialGradient>
                <radialGradient id="fdiGingivaInner" cx="50%" cy="50%" r="65%">
                  <stop offset="0%" stopColor="#fff5f2" />
                  <stop offset="100%" stopColor="#e8b0a6" />
                </radialGradient>
                <radialGradient id="fdiPalate" cx="50%" cy="40%" r="70%">
                  <stop offset="0%" stopColor="#fff9f7" />
                  <stop offset="55%" stopColor="#f7d8d1" />
                  <stop offset="100%" stopColor="#e8b4aa" />
                </radialGradient>
                <radialGradient id="fdiTongue" cx="50%" cy="55%" r="68%">
                  <stop offset="0%" stopColor="#f7c4bc" />
                  <stop offset="55%" stopColor="#e89a90" />
                  <stop offset="100%" stopColor="#d07a72" />
                </radialGradient>
                <linearGradient id="fdiVestibule" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(214, 140, 130, 0.35)" />
                  <stop offset="100%" stopColor="rgba(196, 110, 100, 0.18)" />
                </linearGradient>
                <linearGradient id="fdiToothIvory" x1="0.15" y1="0" x2="0.9" y2="1">
                  <stop offset="0%" stopColor="#fffef9" />
                  <stop offset="35%" stopColor="#f8f1e3" />
                  <stop offset="70%" stopColor="#ecdfc8" />
                  <stop offset="100%" stopColor="#dcc9a8" />
                </linearGradient>
                <radialGradient id="fdiToothCusp" cx="35%" cy="30%" r="70%">
                  <stop offset="0%" stopColor="rgba(255,255,255,0.65)" />
                  <stop offset="55%" stopColor="rgba(255,248,235,0.22)" />
                  <stop offset="100%" stopColor="rgba(220,200,160,0)" />
                </radialGradient>
                <linearGradient id="fdiToothHighlight" x1="0" y1="0" x2="0.35" y2="1">
                  <stop offset="0%" stopColor="rgba(255,255,255,0.45)" />
                  <stop offset="45%" stopColor="rgba(255,255,255,0.08)" />
                  <stop offset="100%" stopColor="rgba(255,255,255,0)" />
                </linearGradient>
                <linearGradient id="fdiToothShade" x1="0.5" y1="0" x2="0.5" y2="1">
                  <stop offset="0%" stopColor="rgba(180,150,110,0.06)" />
                  <stop offset="100%" stopColor="rgba(150,120,85,0.18)" />
                </linearGradient>
                <filter id="fdiSoftShadow" x="-35%" y="-35%" width="170%" height="170%">
                  <feDropShadow dx="0.4" dy="0.8" stdDeviation="0.7" floodColor="#8b5a4a" floodOpacity="0.18" />
                </filter>
              </defs>

              {/* Soft page wash */}
              <rect x="0" y="0" width={VIEW.width} height={VIEW.height} fill="url(#fdiPageWash)" rx="18" />

              {/* —— Upper arch mouth anatomy (2D occlusal) —— */}
              <g className="fdi-mouth fdi-mouth--upper" aria-hidden="true">
                <path
                  className="fdi-mouth__vestibule"
                  d={vestibulePath({
                    cx: UPPER_ARCH.cx,
                    cy: UPPER_ARCH.cy,
                    outerRx: UPPER_ARCH.rx + 72,
                    outerRy: UPPER_ARCH.ry + 60,
                    innerRx: UPPER_ARCH.rx + 42,
                    innerRy: UPPER_ARCH.ry + 34,
                    invert: false,
                  })}
                  fill="url(#fdiVestibule)"
                />
                <path
                  className="fdi-mouth__gingiva"
                  d={horseshoeBandPath({
                    cx: UPPER_ARCH.cx,
                    cy: UPPER_ARCH.cy,
                    outerRx: UPPER_ARCH.rx + 48,
                    outerRy: UPPER_ARCH.ry + 42,
                    innerRx: UPPER_ARCH.rx - 40,
                    innerRy: UPPER_ARCH.ry - 30,
                    invert: false,
                  })}
                  fill="url(#fdiGingivaBand)"
                  stroke="rgba(176, 110, 100, 0.4)"
                  strokeWidth="1.25"
                />
                <path
                  className="fdi-mouth__gingiva-ridge"
                  d={horseshoeBandPath({
                    cx: UPPER_ARCH.cx,
                    cy: UPPER_ARCH.cy,
                    outerRx: UPPER_ARCH.rx + 22,
                    outerRy: UPPER_ARCH.ry + 18,
                    innerRx: UPPER_ARCH.rx - 28,
                    innerRy: UPPER_ARCH.ry - 20,
                    invert: false,
                  })}
                  fill="url(#fdiGingivaInner)"
                  opacity="0.7"
                />
                <path
                  className="fdi-mouth__palate"
                  d={palatePath({
                    cx: UPPER_ARCH.cx,
                    cy: UPPER_ARCH.cy + 22,
                    rx: UPPER_ARCH.rx - 88,
                    ry: UPPER_ARCH.ry - 36,
                  })}
                  fill="url(#fdiPalate)"
                  stroke="rgba(196, 130, 120, 0.3)"
                  strokeWidth="1"
                />
                <path
                  d={`M ${UPPER_ARCH.cx} ${UPPER_ARCH.cy - 48} Q ${UPPER_ARCH.cx + 3} ${UPPER_ARCH.cy + 14} ${UPPER_ARCH.cx} ${UPPER_ARCH.cy + 78}`}
                  fill="none"
                  stroke="rgba(196, 130, 120, 0.22)"
                  strokeWidth="1.2"
                />
              </g>

              {/* —— Lower arch mouth anatomy (2D occlusal) —— */}
              <g className="fdi-mouth fdi-mouth--lower" aria-hidden="true">
                <path
                  className="fdi-mouth__vestibule"
                  d={vestibulePath({
                    cx: LOWER_ARCH.cx,
                    cy: LOWER_ARCH.cy,
                    outerRx: LOWER_ARCH.rx + 72,
                    outerRy: LOWER_ARCH.ry + 60,
                    innerRx: LOWER_ARCH.rx + 42,
                    innerRy: LOWER_ARCH.ry + 34,
                    invert: true,
                  })}
                  fill="url(#fdiVestibule)"
                />
                <path
                  className="fdi-mouth__gingiva"
                  d={horseshoeBandPath({
                    cx: LOWER_ARCH.cx,
                    cy: LOWER_ARCH.cy,
                    outerRx: LOWER_ARCH.rx + 48,
                    outerRy: LOWER_ARCH.ry + 42,
                    innerRx: LOWER_ARCH.rx - 40,
                    innerRy: LOWER_ARCH.ry - 30,
                    invert: true,
                  })}
                  fill="url(#fdiGingivaBand)"
                  stroke="rgba(176, 110, 100, 0.4)"
                  strokeWidth="1.25"
                />
                <path
                  className="fdi-mouth__gingiva-ridge"
                  d={horseshoeBandPath({
                    cx: LOWER_ARCH.cx,
                    cy: LOWER_ARCH.cy,
                    outerRx: LOWER_ARCH.rx + 22,
                    outerRy: LOWER_ARCH.ry + 18,
                    innerRx: LOWER_ARCH.rx - 28,
                    innerRy: LOWER_ARCH.ry - 20,
                    invert: true,
                  })}
                  fill="url(#fdiGingivaInner)"
                  opacity="0.7"
                />
                <path
                  className="fdi-mouth__tongue"
                  d={tonguePath({
                    cx: LOWER_ARCH.cx,
                    cy: LOWER_ARCH.cy - 16,
                    rx: LOWER_ARCH.rx - 95,
                    ry: LOWER_ARCH.ry - 40,
                  })}
                  fill="url(#fdiTongue)"
                  stroke="rgba(170, 90, 85, 0.3)"
                  strokeWidth="1"
                />
                <path
                  d={`M ${LOWER_ARCH.cx} ${LOWER_ARCH.cy - 72} Q ${LOWER_ARCH.cx - 3} ${LOWER_ARCH.cy - 8} ${LOWER_ARCH.cx} ${LOWER_ARCH.cy + 52}`}
                  fill="none"
                  stroke="rgba(170, 90, 85, 0.25)"
                  strokeWidth="1.15"
                />
              </g>

              <text className="fdi-arch-label" x={VIEW.width / 2} y={258} textAnchor="middle">
                UPPER
              </text>
              <text className="fdi-arch-label" x={VIEW.width / 2} y={593} textAnchor="middle">
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
