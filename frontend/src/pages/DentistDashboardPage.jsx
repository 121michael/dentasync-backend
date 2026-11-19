import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ClipboardList, RefreshCw, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { DentistSummaryCard } from "../components/DentistUI";
import { DashboardSchedulePreview } from "../components/DashboardSchedulePreview";
import { formatDentistDateTime } from "../dentistUtils";

export function DentistDashboardPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (options = {}) => {
    try {
      setData(await api.getDentistDashboard(options));
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load({ silent: true }), 20000);
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
  const metrics = data.metrics || {};
  const clinicDate = data.clinicDate || String(data.date || "").slice(0, 10);
  const timezone = data.timezone || "Asia/Manila";
  const timeframe = `Today · ${clinicDate} (${timezone})`;
  const branchName = data.branch?.name || data.activeBranch?.name;

  return (
    <div className="dentist-page dentist-dashboard-page ops-dashboard-clearance">
      <SectionHeading
        eyebrow="Amethyst clinical floor"
        title="Clinical Overview"
        detail={`${branchName ? `${branchName} · ` : ""}${timeframe}`}
        action={
          <button className="button button--secondary" onClick={load}>
            <RefreshCw size={16} /> Refresh
          </button>
        }
      />

      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}
      {success ? <p className="inline-alert inline-alert--success">{success}</p> : null}

      <section className="dentist-stat-grid dentist-stat-grid--ops">
        <DentistSummaryCard
          label="Booked Today"
          value={metrics.bookedToday ?? metrics.todaysTarget ?? 0}
          timeframe={timeframe}
          detail="Your scheduled visits, excluding cancelled and no-show"
          icon={Users}
          tone="purple"
          to="/dentist/appointments"
        />
        <DentistSummaryCard
          label="Checked In"
          value={metrics.checkedIn ?? 0}
          timeframe={timeframe}
          detail="Arrived and not yet waiting or in treatment"
          icon={ClipboardList}
          tone="violet"
          to="/dentist/queue?tab=checked_in"
        />
        <DentistSummaryCard
          label="Waiting"
          value={metrics.waiting ?? metrics.remainingQueue ?? 0}
          timeframe={timeframe}
          detail="In your waiting line"
          icon={ClipboardList}
          tone="violet"
          to="/dentist/queue?tab=waiting"
          actionable={Number(metrics.waiting ?? 0) > 0}
        />
        <DentistSummaryCard
          label="In Treatment"
          value={metrics.inTreatment ?? 0}
          timeframe={timeframe}
          detail="Preparing or in chair"
          icon={ClipboardList}
          tone="purple"
          to="/dentist/queue?tab=ongoing"
        />
        <DentistSummaryCard
          label="Completed"
          value={metrics.completedToday ?? 0}
          timeframe={timeframe}
          detail="Finished visits in today’s queue"
          icon={CheckCircle2}
          tone="emerald"
          to="/dentist/queue?tab=completed"
        />
        <DentistSummaryCard
          label="No-show"
          value={metrics.noShowToday ?? 0}
          timeframe={timeframe}
          detail="No-show entries in today’s queue"
          icon={ClipboardList}
          tone="violet"
          to="/dentist/queue?tab=no_show"
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

      <section className="dentist-panel">
        <div className="dentist-panel__heading">
          <div>
            <span className="eyebrow">Clinic date {clinicDate}</span>
            <h2>Today’s Schedule</h2>
          </div>
        </div>
        <DashboardSchedulePreview
          rows={data.schedulePreview || []}
          appointmentBase="/dentist/appointments"
          queueBase="/dentist/queue"
        />
      </section>
    </div>
  );
}
