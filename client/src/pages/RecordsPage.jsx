import { useCallback, useEffect, useState } from "react";
import {
  Download,
  FileImage,
  FileText,
  LockKeyhole,
} from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, SectionHeading } from "../components/UI";

function displayDate(value) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function formatSize(size) {
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
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setRecordsData(await api.getRecords());
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
        detail="Secure access to your dental treatment records and documents."
      />

      {error && <p className="inline-alert inline-alert--error">{error}</p>}

      <section className="records-summary-grid">
        <RecordSummary label="Total visits" value={recordsData.summary.totalVisits} tone="purple" />
        <RecordSummary label="Completed treatments" value={recordsData.summary.completedTreatments} tone="emerald" />
        <RecordSummary label="X-rays available" value={recordsData.summary.xRaysAvailable} tone="violet" />
        <RecordSummary label="Active treatment plans" value={recordsData.summary.activeTreatmentPlans} tone="amber" />
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
