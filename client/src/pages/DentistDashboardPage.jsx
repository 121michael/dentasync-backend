import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ClipboardList, RefreshCw, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { DentistSummaryCard } from "../components/DentistUI";
import { formatDentistDateTime } from "../dentistUtils";

export function DentistDashboardPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.getDentistDashboard());
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 20000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function markPatientFinished() {
    if (!data?.nextPatient || data.nextPatient.status !== "in_chair") return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await api.updateDentistQueue(data.nextPatient.id, { status: "completed" });
      setSuccess(`${data.nextPatient.patientName} marked as finished.`);
      await load();
    } catch (finishError) {
      setError(finishError.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading clinical overview…" />;

  const next = data.nextPatient;
  const inChair = next?.status === "in_chair";

  return (
    <div className="dentist-page">
      <SectionHeading
        eyebrow="Amethyst clinical floor"
        title="Clinical Overview"
        detail={formatDentistDateTime(data.date)}
        action={
          <button className="button button--secondary" onClick={load}>
            <RefreshCw size={16} /> Refresh
          </button>
        }
      />

      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}
      {success ? <p className="inline-alert inline-alert--success">{success}</p> : null}

      <section className="dentist-stat-grid">
        <DentistSummaryCard
          label="Today's Target"
          value={`${data.metrics.todaysTarget} Patients`}
          icon={Users}
          tone="purple"
        />
        <DentistSummaryCard
          label="Remaining Queue"
          value={`${data.metrics.remainingQueue} Left`}
          icon={ClipboardList}
          tone="violet"
        />
        <DentistSummaryCard
          label="Completed Today"
          value={`${data.metrics.completedToday} Done`}
          icon={CheckCircle2}
          tone="emerald"
        />
      </section>

      <section className="dentist-next-card">
        <div>
          <span className="eyebrow eyebrow--light">
            {inChair ? "In chair · Active visit" : "Next up · Important"}
          </span>
          {next ? (
            <>
              <h2>{next.patientName}</h2>
              <p>{next.procedure}</p>
            </>
          ) : (
            <>
              <h2>No patient waiting</h2>
              <p>Your treatment queue is clear. New check-ins for your schedule will appear here.</p>
            </>
          )}
        </div>
        <div className="dentist-heading-actions">
          {inChair ? (
            <button
              type="button"
              className="button button--light"
              onClick={markPatientFinished}
              disabled={busy}
            >
              {busy ? "Saving…" : "Patient is finished"}
            </button>
          ) : null}
          <Link className="button button--light" to="/dentist/queue">
            Go to Queue
          </Link>
        </div>
      </section>
    </div>
  );
}
