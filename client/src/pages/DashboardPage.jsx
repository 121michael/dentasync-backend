import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  CalendarDays,
  CircleCheck,
  ClipboardList,
  Clock3,
  FileText,
  HeartPulse,
  MapPin,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  UsersRound,
} from "lucide-react";
import { api } from "../api";
import { DetailLink, ErrorState, LoadingState } from "../components/UI";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function prettyDate(value) {
  if (!value) return "To be recommended";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function prettyTime(value) {
  if (!value) return "";
  const [hours, minutes] = value.split(":");
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2026, 0, 1, Number(hours), Number(minutes)));
}

function MetricCard({ icon: Icon, label, value, tone, detail }) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <span className="metric-card__icon">
        <Icon size={19} aria-hidden="true" />
      </span>
      <span className="metric-card__label">{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState("");

  const loadDashboard = useCallback(async () => {
    setError("");
    try {
      setDashboard(await api.getDashboard());
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  if (error) return <ErrorState message={error} onRetry={loadDashboard} />;
  if (!dashboard) return <LoadingState />;

  const appointment = dashboard.nextAppointment;
  const firstName = dashboard.patient.firstName || "there";
  const wellness = dashboard.wellness;
  const healthScore = wellness.oralHealthScore;

  return (
    <div className="dashboard-page">
      <section className="dashboard-welcome">
        <div>
          <span className="eyebrow">Your personal care space</span>
          <h1>
            {greeting()}, <span>{firstName}</span>
          </h1>
          <p>Here’s your dental care overview, designed around your next best step.</p>
        </div>
        <div className="dashboard-welcome__seal">
          <ShieldCheck size={19} />
          <span>Verified premium patient</span>
        </div>
      </section>

      {appointment ? (
        <section className="next-visit-card">
          <div className="next-visit-card__sparkle">
            <Sparkles size={26} />
          </div>
          <div className="next-visit-card__content">
            <span className="eyebrow eyebrow--light">Your next visit is confirmed</span>
            <h2>{appointment.treatment}</h2>
            <div className="next-visit-card__details">
              <span>
                <CalendarDays size={17} /> {prettyDate(appointment.date)}
              </span>
              <span>
                <Clock3 size={17} /> {prettyTime(appointment.time)}
              </span>
              <span>
                <Stethoscope size={17} /> {appointment.dentist}
              </span>
              <span>
                <MapPin size={17} /> {appointment.location}
              </span>
            </div>
          </div>
          <button className="button button--light" onClick={() => navigate("/appointments")}>
            View appointment <ArrowRight size={17} />
          </button>
        </section>
      ) : (
        <section className="next-visit-card next-visit-card--empty">
          <div className="next-visit-card__sparkle">
            <CalendarDays size={26} />
          </div>
          <div className="next-visit-card__content">
            <span className="eyebrow eyebrow--light">Your care, on your schedule</span>
            <h2>Ready when you are</h2>
            <p>Reserve your next dental visit in a few thoughtful steps.</p>
          </div>
          <button className="button button--light" onClick={() => navigate("/appointments")}>
            Book a visit <ArrowRight size={17} />
          </button>
        </section>
      )}

      <section className="metrics-grid" aria-label="Patient care metrics">
        <MetricCard
          icon={CalendarDays}
          label="Active appointments"
          value={dashboard.metrics.activeAppointments}
          detail="Scheduled in your care plan"
          tone="purple"
        />
        <MetricCard
          icon={CircleCheck}
          label="Completed visits"
          value={dashboard.metrics.completedVisits}
          detail="Care moments completed"
          tone="emerald"
        />
        <MetricCard
          icon={UsersRound}
          label="Current queue token"
          value={dashboard.metrics.queueToken || "—"}
          detail={dashboard.queue ? `${dashboard.queue.estimatedWaitMinutes} min estimated wait` : "No active queue ticket"}
          tone="amber"
        />
        <MetricCard
          icon={ShieldCheck}
          label="HMO coverage"
          value={
            dashboard.metrics.hmoStatus === "not_enrolled"
              ? "Not enrolled"
              : dashboard.metrics.hmoStatus.replaceAll("_", " ")
          }
          detail="Coverage verification status"
          tone="violet"
        />
      </section>

      <section className="dashboard-lower-grid">
        <article className="glass-card wellness-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Preventive care</span>
              <h2>Dental wellness progress</h2>
            </div>
            <span className="card-icon card-icon--lavender">
              <HeartPulse size={20} />
            </span>
          </div>
          <div className="wellness-card__score">
            <div className="score-ring" style={{ "--score": `${healthScore || 0}%` }}>
              <strong>{healthScore ?? "—"}</strong>
              <small>{healthScore === null ? "pending" : "/ 100"}</small>
            </div>
            <div>
              <strong>{healthScore === null ? "Your first assessment is ahead" : "Your oral health score"}</strong>
              <p>
                {healthScore === null
                  ? "Your clinician will add an individualized wellness score after your next visit."
                  : "A calm, consistent care routine keeps your smile moving forward."}
              </p>
            </div>
          </div>
          <div className="wellness-card__facts">
            <span>
              <small>Last cleaning</small>
              <strong>{wellness.lastCleaning ? prettyDate(wellness.lastCleaning) : "Not recorded"}</strong>
            </span>
            <span>
              <small>Next recommended checkup</small>
              <strong>{prettyDate(wellness.nextCheckup)}</strong>
            </span>
          </div>
          <div className="progress-track" aria-label={`Preventive care progress ${healthScore || 0}%`}>
            <span style={{ width: `${healthScore || 0}%` }} />
          </div>
        </article>

        <article className="glass-card quick-actions-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">At your fingertips</span>
              <h2>Quick actions</h2>
            </div>
          </div>
          <div className="quick-actions">
            {[
              { label: "Book appointment", detail: "Choose a treatment and time", icon: CalendarDays, to: "/appointments" },
              { label: "Track live queue", detail: "See your place in line", icon: UsersRound, to: "/queue" },
              { label: "View records", detail: "Review your care archive", icon: FileText, to: "/records" },
              { label: "Contact clinic", detail: "Get help from our care team", icon: ClipboardList, to: "/support" },
            ].map(({ label, detail, icon: Icon, to }) => (
              <button key={label} className="quick-action" onClick={() => navigate(to)}>
                <span>
                  <Icon size={19} />
                </span>
                <div>
                  <strong>{label}</strong>
                  <small>{detail}</small>
                </div>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
        </article>
      </section>

      <section className="dashboard-footnote">
        <div>
          <Sparkles size={17} />
          <span>Thoughtful care, designed to feel clear and unhurried.</span>
        </div>
        <DetailLink onClick={() => navigate("/profile")}>Review your profile</DetailLink>
      </section>
    </div>
  );
}
