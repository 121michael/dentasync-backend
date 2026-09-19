import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { ErrorState, LoadingState } from "../UI";
import { Tooth } from "./Tooth";
import { ToothDetailsPanel } from "./ToothDetailsPanel";
import {
  TREATMENT_OPTIONS,
  buildDefaultChart,
  dentitionForPatient,
  emptyToothRecord,
  isPrimaryTooth,
  labelFor,
  normalizeChartEntry,
  teethForDentition,
} from "./dentalChartData";

function hasChartStatus(entry) {
  if (!entry) return false;
  const conditions = entry.condition || [];
  const meaningfulCondition =
    conditions.length && !(conditions.length === 1 && conditions[0] === "healthy");
  return Boolean(
    meaningfulCondition ||
      (entry.treatments && entry.treatments.length) ||
      (entry.notes && entry.notes.trim()) ||
      (entry.status && entry.status !== "healthy")
  );
}

export function DentalChart({
  patientId,
  readOnly = false,
  refreshKey = 0,
  loadChartApi,
  pickMode = false,
  selectedTeeth = [],
  onTeethChange,
  patientCategory,
  patientAge,
}) {
  const [chart, setChart] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [selectedTooth, setSelectedTooth] = useState("");
  const [draft, setDraft] = useState(null);
  const [dentition, setDentition] = useState(() =>
    dentitionForPatient({ category: patientCategory, age: patientAge })
  );
  const [dentitionPinned, setDentitionPinned] = useState(false);

  const picked = useMemo(
    () => new Set((selectedTeeth || []).map((tooth) => String(tooth))),
    [selectedTeeth]
  );

  async function loadChart() {
    if (!patientId) return;
    setLoadError("");
    try {
      const loader = loadChartApi || api.getDentistDentalChart;
      const response = await loader(patientId, { silent: Boolean(refreshKey) });
      const next = buildDefaultChart();
      let primaryEntries = 0;
      for (const entry of response.entries || response.chart || []) {
        const normalized = normalizeChartEntry(entry);
        if (!normalized.toothNumber) continue;
        next[normalized.toothNumber] = normalized;
        if (isPrimaryTooth(normalized.toothNumber) && hasChartStatus(normalized)) {
          primaryEntries += 1;
        }
      }
      setChart(next);
      if (primaryEntries && !dentitionPinned) setDentition("primary");
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
    setDentitionPinned(false);
    setDentition(dentitionForPatient({ category: patientCategory, age: patientAge }));
    loadChart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  useEffect(() => {
    if (!patientId || !refreshKey) return;
    loadChart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const { upper, lower, all } = useMemo(() => teethForDentition(dentition), [dentition]);
  const half = upper.length / 2;

  function selectTooth(toothNumber) {
    const key = String(toothNumber);
    if (pickMode && typeof onTeethChange === "function") {
      const next = new Set(picked);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      onTeethChange([...next].sort((a, b) => Number(a) - Number(b)));
      return;
    }

    const record = chart?.[key] || emptyToothRecord(key);
    setSelectedTooth(key);
    setDraft({
      ...record,
      condition: [...(record.condition || [])],
      treatments: [...(record.treatments || [])],
    });
  }

  function switchDentition(next) {
    setDentitionPinned(true);
    setDentition(next);
    setSelectedTooth("");
    setDraft(null);
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

  const recordedCount = all.filter((tooth) => hasChartStatus(chart[String(tooth)])).length;

  function renderRow(teeth, arch) {
    const right = teeth.slice(0, half);
    const left = teeth.slice(half);
    return (
      <div className="odo-row" style={{ "--odo-half": half }}>
        {right.map((tooth) => (
          <Tooth
            key={`${arch}-${tooth}`}
            toothNumber={tooth}
            arch={arch}
            record={chart[String(tooth)]}
            selected={
              pickMode ? picked.has(String(tooth)) : String(selectedTooth) === String(tooth)
            }
            onSelect={selectTooth}
          />
        ))}
        <span className="odo-midline" aria-hidden="true" />
        {left.map((tooth) => (
          <Tooth
            key={`${arch}-${tooth}`}
            toothNumber={tooth}
            arch={arch}
            record={chart[String(tooth)]}
            selected={
              pickMode ? picked.has(String(tooth)) : String(selectedTooth) === String(tooth)
            }
            onSelect={selectTooth}
          />
        ))}
      </div>
    );
  }

  return (
    <section className={`fdi-chart-shell ${pickMode ? "fdi-chart-shell--pick" : ""}`}>
      <div className="fdi-chart-layout">
        <div className="fdi-chart-canvas glass-card">
          <div className="fdi-chart-canvas__head">
            <div>
              <span className="eyebrow">
                {pickMode ? "Select affected tooth" : "FDI odontogram — front view"}
              </span>
              <h2>2D Dental Chart</h2>
              <p className="muted-copy">
                {pickMode
                  ? "Click one or more teeth on the chart to mark them for this treatment. Selected teeth are highlighted."
                  : "Chart status is driven by saved treatment records. Saving a treatment updates the matching tooth automatically."}
              </p>
            </div>
            <div className="odo-head-meta">
              <div className="odo-dentition" role="group" aria-label="Dentition">
                <button
                  type="button"
                  className={`odo-dentition__option ${dentition === "permanent" ? "is-active" : ""}`}
                  onClick={() => switchDentition("permanent")}
                >
                  Adult
                </button>
                <button
                  type="button"
                  className={`odo-dentition__option ${dentition === "primary" ? "is-active" : ""}`}
                  onClick={() => switchDentition("primary")}
                >
                  Pediatric
                </button>
              </div>
              <small className="fdi-chart-count">
                {pickMode
                  ? picked.size
                    ? `${picked.size} ${picked.size === 1 ? "tooth" : "teeth"} selected`
                    : "No tooth selected yet"
                  : recordedCount
                    ? `${recordedCount} teeth with chart status`
                    : "No treatment-driven chart status yet."}
              </small>
            </div>
          </div>

          {pickMode && picked.size ? (
            <p className="fdi-pick-chips">
              {[...picked].map((tooth) => (
                <button
                  key={tooth}
                  type="button"
                  className="fdi-pick-chip"
                  onClick={() => selectTooth(tooth)}
                  title="Click to deselect"
                >
                  #{tooth} ×
                </button>
              ))}
            </p>
          ) : null}

          <div className="odo-scroll">
            <div className={`odo-chart odo-chart--${dentition}`}>
              <div className="odo-arch">
                <span className="odo-arch__label">Upper Teeth — Front View</span>
                {renderRow(upper, "upper")}
              </div>
              <div className="odo-arch odo-arch--lower">
                <span className="odo-arch__label">Lower Teeth — Front View</span>
                {renderRow(lower, "lower")}
              </div>
            </div>
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
          {!pickMode && selectedTooth && chart[selectedTooth]?.treatments?.length ? (
            <p className="muted-copy" style={{ marginTop: "0.75rem" }}>
              Tooth #{selectedTooth}:{" "}
              {(chart[selectedTooth].treatments || [])
                .map((value) => labelFor(value, TREATMENT_OPTIONS))
                .join(" → ")}
            </p>
          ) : null}
        </div>

        {!pickMode ? (
          <ToothDetailsPanel
            toothNumber={selectedTooth}
            draft={draft}
            readOnly={readOnly}
            onCancel={() => {
              setSelectedTooth("");
              setDraft(null);
            }}
          />
        ) : null}
      </div>
    </section>
  );
}
