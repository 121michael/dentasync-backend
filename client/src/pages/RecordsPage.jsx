import { useCallback, useEffect, useState } from "react";
import {
  Download,
  FileImage,
  FileText,
  LockKeyhole,
  Upload,
} from "lucide-react";
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
  const [success, setSuccess] = useState("");
  const [uploading, setUploading] = useState(false);

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

  async function uploadXray(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.uploadXray(file);
      setSuccess(response.message || "X-ray uploaded successfully.");
      await load();
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setUploading(false);
    }
  }

  if (error && !recordsData) return <ErrorState message={error} onRetry={load} />;
  if (!recordsData) return <LoadingState label="Opening your secure treatment archive" />;

  return (
    <div className="records-page">
      <SectionHeading
        eyebrow="Your private archive"
        title="Treatment history"
        detail="Secure access to your dental treatment records and documents."
      />

      {error && <p className="inline-alert inline-alert--error">{error}</p>}
      {success && <p className="inline-alert inline-alert--success">{success}</p>}

      <section className="records-summary-grid">
        <RecordSummary label="Total visits" value={recordsData.summary.totalVisits} tone="purple" />
        <RecordSummary label="Completed treatments" value={recordsData.summary.completedTreatments} tone="emerald" />
        <RecordSummary
          label="X-rays available"
          value={Math.max(recordsData.summary.xRaysAvailable || 0, xrays.length)}
          tone="violet"
        />
        <RecordSummary label="Active treatment plans" value={recordsData.summary.activeTreatmentPlans} tone="amber" />
      </section>

      <section className="glass-card booking-section xray-upload-section">
        <div className="card-heading">
          <div>
            <span className="eyebrow">Imaging</span>
            <h2>X-ray uploads</h2>
          </div>
          <FileImage className="card-heading__icon" size={21} />
        </div>
        <p className="muted-copy">
          Upload dental X-rays for your care team. Any automated analysis is preliminary only and is not a
          clinical diagnosis.
        </p>
        <label className="file-drop">
          <Upload size={21} />
          <span>
            <strong>{uploading ? "Uploading…" : "Upload X-ray image"}</strong>
            <small>JPG, PNG, or PDF — securely stored in your records</small>
          </span>
          <input
            type="file"
            accept=".pdf,image/jpeg,image/png,image/webp"
            disabled={uploading}
            onChange={uploadXray}
          />
        </label>

        {xrays.length ? (
          <div className="xray-list">
            {xrays.map((xray) => (
              <article className="xray-row" key={xray.id || xray.documentId}>
                <span className="document-row__icon">
                  <FileImage size={18} />
                </span>
                <div>
                  <strong>{xray.name || xray.fileName || "X-ray image"}</strong>
                  <small>
                    {displayDate(xray.uploadedAt || xray.createdAt || xray.date)}
                    {xray.size ? ` · ${formatSize(xray.size)}` : ""}
                  </small>
                  <span className={`status-pill status-pill--${String(xray.analysis?.status || xray.status || "unavailable").replaceAll("_", "-")}`}>
                    {String(xray.analysis?.status || xray.status || "unavailable").replaceAll("_", " ")}
                  </span>
                  {xray.analysis?.summary || xray.summary ? (
                    <p className="muted-copy">{xray.analysis?.summary || xray.summary}</p>
                  ) : null}
                  {xray.analysis?.confidence != null ? (
                    <small>Confidence: {xray.analysis.confidence}%</small>
                  ) : null}
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
          <p className="muted-copy">No X-rays uploaded yet.</p>
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
                        <p>{record.dentist || "Amethyst Dental care team"} · {record.clinic || "Amethyst Dental"}</p>
                      </div>
                      <span className={`status-pill status-pill--${record.status}`}>{record.status.replaceAll("_", " ")}</span>
                    </div>
                    <div className="record-entry__meta">
                      <span>{record.coverage || "Coverage not recorded"}</span>
                      {record.notes && <span>{record.notes}</span>}
                    </div>
                    {record.documents.length > 0 && (
                      <div className="record-entry__documents">
                        {record.documents.map((document) => (
                          <button
                            key={document.id}
                            onClick={() => downloadDocument(record.id, document)}
                            className="document-chip"
                          >
                            {document.mimeType.startsWith("image") ? <FileImage size={15} /> : <FileText size={15} />}
                            {document.name}
                            <Download size={14} />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Your treatment archive is ready"
              detail="Completed visits and clinician-shared records will appear here securely."
            />
          )}
        </article>

        <aside className="documents-card glass-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Secure files</span>
              <h2>Documents</h2>
            </div>
          </div>
          {recordsData.documents.length ? (
            <div className="document-list">
              {recordsData.documents.map((document) => (
                <button
                  className="document-row"
                  key={document.id}
                  onClick={() => downloadPortalDocument(document)}
                  title={`Download ${document.name}`}
                >
                  <span className="document-row__icon">
                    {document.mimeType.startsWith("image") ? <FileImage size={18} /> : <FileText size={18} />}
                  </span>
                  <div>
                    <strong>{document.name}</strong>
                    <small>{document.type.replaceAll("_", " ")} · {formatSize(document.size)}</small>
                  </div>
                  <Download size={16} />
                </button>
              ))}
            </div>
          ) : (
            <p className="muted-copy">Files shared by your clinical team will appear here.</p>
          )}
        </aside>
      </section>

      <section className="privacy-banner">
        <LockKeyhole size={20} />
        <div>
          <strong>Your medical records are securely stored.</strong>
          <span>They are accessible only through your authorized patient account.</span>
        </div>
      </section>
    </div>
  );
}
