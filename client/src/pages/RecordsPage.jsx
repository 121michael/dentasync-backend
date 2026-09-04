import { useCallback, useEffect, useState } from "react";
import { Download, FileImage, FileText, LockKeyhole } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, SectionHeading } from "../components/UI";

function displayDate(value) {
  if (!value) return "—";
  const date = new Date(value.includes?.("T") ? value : `${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatSize(size) {
  if (size == null) return "";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function RecordSummary({ label, value, tone }) {
  return (
    <article className={`record-summary record-summary--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

export function RecordsPage() {
  const [recordsData, setRecordsData] = useState(null);
  const [xrays, setXrays] = useState([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [recordsResponse, xrayResponse] = await Promise.all([
        api.getRecords(),
        api.getXrays().catch(() => ({ xrays: [] })),
      ]);
      setRecordsData(recordsResponse);
      setXrays(xrayResponse.xrays || xrayResponse.items || []);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function downloadDocument(recordId, document) {
    try {
      await api.downloadRecordDocument(recordId, document);
    } catch (downloadError) {
      setError(downloadError.message);
    }
  }

  async function downloadPortalDocument(document) {
    try {
      await api.downloadPortalDocument(document);
    } catch (downloadError) {
      setError(downloadError.message);
    }
  }

  if (error && !recordsData) return <ErrorState message={error} onRetry={load} />;
  if (!recordsData) return <LoadingState label="Opening your secure treatment archive" />;

  return (
    <div className="records-page">
      <SectionHeading
        eyebrow="Your private archive"
        title="Treatment history"
        detail="Completed appointments and clinician-shared records for your authenticated account only."
      />

      {error && <p className="inline-alert inline-alert--error">{error}</p>}

      <section className="records-summary-grid">
        <RecordSummary label="Total visits" value={recordsData.summary.totalVisits} tone="purple" />
        <RecordSummary
          label="Completed treatments"
          value={recordsData.summary.completedTreatments}
          tone="emerald"
        />
        <RecordSummary
          label="Images on file"
          value={Math.max(recordsData.summary.xRaysAvailable || 0, xrays.length)}
          tone="violet"
        />
        <RecordSummary
          label="Active treatment plans"
          value={recordsData.summary.activeTreatmentPlans}
          tone="amber"
        />
      </section>

      <section className="glass-card booking-section">
        <div className="card-heading">
          <div>
            <span className="eyebrow">Imaging</span>
            <h2>Images shared via AI Assistant</h2>
          </div>
          <FileImage className="card-heading__icon" size={21} />
        </div>
        <p className="muted-copy">
          Upload dental photos or X-rays from the{" "}
          <Link to="/assistant">AI Assistant</Link> using the + attachment button. Preliminary AI notes
          are not a diagnosis.
        </p>
        {xrays.length ? (
          <div className="xray-list">
            {xrays.map((xray) => (
              <article className="xray-row" key={xray.id || xray.documentId}>
                <span className="document-row__icon">
                  <FileImage size={18} />
                </span>
                <div>
                  <strong>{xray.name || xray.fileName || "Dental image"}</strong>
                  <small>
                    {displayDate(xray.uploadedAt || xray.createdAt || xray.date)}
                    {xray.size ? ` · ${formatSize(xray.size)}` : ""}
                  </small>
                  <span
                    className={`status-pill status-pill--${String(
                      xray.analysis?.status || xray.status || "unavailable"
                    ).replaceAll("_", "-")}`}
                  >
                    {String(xray.analysis?.status || xray.status || "unavailable").replaceAll(
                      "_",
                      " "
                    )}
                  </span>
                  <p className="xray-disclaimer">
                    {xray.analysis?.disclaimer ||
                      xray.disclaimer ||
                      "Preliminary / supplementary information only. Not a clinical diagnosis."}
                  </p>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted-copy">No images on file yet. Open AI Assistant and use + to attach one.</p>
        )}
      </section>

      <section className="records-layout">
        <article className="record-timeline-card glass-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Care over time</span>
              <h2>Your treatment timeline</h2>
            </div>
          </div>
          {recordsData.records.length ? (
            <div className="record-timeline">
              {recordsData.records.map((record) => (
                <article className="record-entry" key={record.id}>
                  <span className="record-entry__dot" />
                  <div className="record-entry__date">{displayDate(record.date)}</div>
                  <div className="record-entry__body">
                    <div className="record-entry__heading">
                      <div>
                        <h3>{record.treatment}</h3>
                        <p>
                          {record.dentist || "Amethyst Dental care team"} ·{" "}
                          {record.clinic || "Amethyst Dental"}
                          {record.source === "appointment" ? " · From completed appointment" : ""}
                        </p>
                      </div>
                      <span className={`status-pill status-pill--${record.status}`}>
                        {String(record.status || "").replaceAll("_", " ")}
                      </span>
                    </div>
                    <div className="record-entry__meta">
                      <span>{record.coverage || "Coverage not recorded"}</span>
                      {record.notes ? <span>{record.notes}</span> : null}
                    </div>
                    {record.documents?.length > 0 ? (
                      <div className="record-entry__documents">
                        {record.documents.map((document) => (
                          <button
                            key={document.id}
                            onClick={() => downloadDocument(record.id, document)}
                            className="document-chip"
                          >
                            {document.mimeType?.startsWith("image") ? (
                              <FileImage size={15} />
                            ) : (
                              <FileText size={15} />
                            )}
                            {document.name}
                            <Download size={14} />
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No completed treatments yet"
              detail="Completed appointments for your account will appear here. Cancelled visits are excluded."
            />
          )}
        </article>

        <aside className="documents-card glass-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Secure files</span>
              <h2>Documents</h2>
            </div>
            <LockKeyhole size={18} />
          </div>
          {recordsData.documents.length ? (
            <div className="document-list">
              {recordsData.documents.map((document) => (
                <button
                  className="document-row"
                  key={document.id}
                  onClick={() => downloadPortalDocument(document)}
                >
                  <span className="document-row__icon">
                    {document.mimeType?.startsWith("image") ? (
                      <FileImage size={16} />
                    ) : (
                      <FileText size={16} />
                    )}
                  </span>
                  <span>
                    <strong>{document.name}</strong>
                    <small>{displayDate(document.createdAt)}</small>
                  </span>
                  <Download size={15} />
                </button>
              ))}
            </div>
          ) : (
            <p className="muted-copy">No standalone documents yet.</p>
          )}
        </aside>
      </section>
    </div>
  );
}
