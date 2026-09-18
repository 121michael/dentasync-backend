import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { ErrorState, LoadingState } from "../UI";
import { Tooth } from "./Tooth";
import { ToothDetailsPanel } from "./ToothDetailsPanel";
import {
  ALL_TEETH,
  LOWER_TEETH,
  TREATMENT_OPTIONS,
  UPPER_TEETH,
  buildDefaultChart,
  emptyToothRecord,
  labelFor,
  normalizeChartEntry,
  toothPositions,
} from "./dentalChartData";
import { gumArchStrokePath } from "./mouthShapes";

const VIEW = { width: 860, height: 680 };

const UPPER_ARCH = { cx: VIEW.width / 2, cy: 208, rx: 232, ry: 138 };
const LOWER_ARCH = { cx: VIEW.width / 2, cy: 462, rx: 232, ry: 138 };

export function DentalChart({
  patientId,
  onTreatmentRecorded,
  readOnly = false,
  refreshKey = 0,
  loadChartApi,
}) {
  const [chart, setChart] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [selectedTooth, setSelectedTooth] = useState("");
  const [draft, setDraft] = useState(null);

  async function loadChart() {
    if (!patientId) return;
    setLoadError("");
    try {
      const loader = loadChartApi || api.getDentistDentalChart;
      const response = await loader(patientId);
      const next = buildDefaultChart();
      for (const entry of response.entries || response.chart || []) {
        const normalized = normalizeChartEntry(entry);
        if (normalized.toothNumber) {
          next[normalized.toothNumber] = normalized;
        }
      }
      setChart(next);
      if (selectedTooth && next[selectedTooth]) {
        setDraft({
          ...next[selectedTooth],
          condition: [...(next[selectedTooth].condition || [])],
          treatments: [...(next[selectedTooth].treatments || [])],
        });
      }
    } catch (error) {
      setLoadError(error.message || "Unable to load dental chart.");
      setChart(null);
    }
  }

  useEffect(() => {
    setSelectedTooth("");
    setDraft(null);
    setChart(null);
    loadChart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  useEffect(() => {
    if (!patientId || !refreshKey) return;
    loadChart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const upperPositions = useMemo(
    () =>
      toothPositions(UPPER_TEETH, {
        ...UPPER_ARCH,
        invert: false,
        labelPad: 42,
        viewWidth: VIEW.width,
        viewHeight: VIEW.height,
      }),
    []
  );

  const lowerPositions = useMemo(
    () =>
      toothPositions(LOWER_TEETH, {
        ...LOWER_ARCH,
        invert: true,
        labelPad: 42,
        viewWidth: VIEW.width,
        viewHeight: VIEW.height,
      }),
    []
  );

  function selectTooth(toothNumber) {
    const key = String(toothNumber);
    const record = chart?.[key] || emptyToothRecord(key);
    setSelectedTooth(key);
    setDraft({
      ...record,
      condition: [...(record.condition || [])],
      treatments: [...(record.treatments || [])],
    });
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
      ((entry.condition &&
        entry.condition.length &&
        !(entry.condition.length === 1 && entry.condition[0] === "healthy")) ||
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
                Chart status is driven by saved treatment records. Saving Root Canal on tooth #36
                marks #36 as Root Canal automatically.
              </p>
            </div>
            <small className="fdi-chart-count">
              {recordedCount
                ? `${recordedCount} teeth with chart status`
                : "No treatment-driven chart status yet."}
            </small>
          </div>

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

              <g className="fdi-mouth" aria-hidden="true">
                <path
                  d={gumArchStrokePath({ ...UPPER_ARCH, invert: false })}
                  fill="none"
                  stroke="rgba(230, 115, 105, 0.55)"
                  strokeWidth="42"
                  strokeLinecap="round"
                  filter="url(#fdiGumBlur)"
                />
                <path
                  d={gumArchStrokePath({ ...LOWER_ARCH, invert: true })}
                  fill="none"
                  stroke="rgba(230, 115, 105, 0.55)"
                  strokeWidth="42"
                  strokeLinecap="round"
                  filter="url(#fdiGumBlur)"
                />
              </g>

              <text className="fdi-arch-label" x={VIEW.width / 2} y={212} textAnchor="middle">
                UPPER
              </text>
              <text className="fdi-arch-label" x={VIEW.width / 2} y={458} textAnchor="middle">
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
            <span className="fdi-legend__item fdi-legend__item--treated">
              Treated (Root Canal / Filling / Crown)
            </span>
            <span className="fdi-legend__item fdi-legend__item--under_treatment">Under Treatment</span>
            <span className="fdi-legend__item fdi-legend__item--missing">Extracted / Missing</span>
          </div>
          {selectedTooth && chart[selectedTooth]?.treatments?.length ? (
            <p className="muted-copy" style={{ marginTop: "0.75rem" }}>
              Tooth #{selectedTooth}:{" "}
              {(chart[selectedTooth].treatments || [])
                .map((value) => labelFor(value, TREATMENT_OPTIONS))
                .join(" → ")}
            </p>
          ) : null}
        </div>

        <ToothDetailsPanel
          toothNumber={selectedTooth}
          draft={draft}
          readOnly={readOnly}
          onCancel={() => {
            setSelectedTooth("");
            setDraft(null);
          }}
        />
      </div>
    </section>
  );
}
