import { useCallback, useEffect, useState } from "react";
import { Cloud, RefreshCw } from "lucide-react";
import { api } from "../api";
import { ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { formatAdminDateTime } from "../adminUtils";

function StatusDot({ ok, label, detail }) {
  return (
    <article className={`admin-health-card ${ok ? "is-online" : "is-offline"}`}>
      <span className="admin-health-card__dot" />
      <div>
        <strong>{label}</strong>
        <small>{detail || (ok ? "Connected" : "Unavailable")}</small>
      </div>
    </article>
  );
}

export function AdminSyncPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.getAdminSync());
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function synchronize() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await api.runAdminSync();
      setMessage(response.result?.detail || "Synchronization completed.");
      await load();
    } catch (syncError) {
      setError(syncError.message || syncError.data?.result?.detail || "Synchronization failed.");
      if (syncError.data?.result || syncError.data?.event) {
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Checking system synchronization…" />;

  const health = data.health;
  const latestSync = data.events?.[0] || null;
  const synchronized = Boolean(health.database && health.api && latestSync?.status === "success");

  return (
    <div className="admin-page">
      <SectionHeading
        eyebrow="Infrastructure"
        title="System Synchronization"
        detail="Verify live connectivity across database, API, email, and authentication services."
        action={
          <button className="button button--primary" onClick={synchronize} disabled={busy}>
            <Cloud size={16} /> {busy ? "Synchronizing…" : "Synchronize Now"}
          </button>
        }
      />

      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}
      {message ? <p className="inline-alert inline-alert--success">{message}</p> : null}

      <section className="admin-panel admin-sync-hero">
        <div>
          <span className="eyebrow">Cloud Data Synchronization</span>
          <h2>{synchronized ? "Connected / Synchronized" : health.database ? "Connected" : "Synchronization Interrupted"}</h2>
          <p>Last synchronization: {latestSync ? formatAdminDateTime(latestSync.createdAt) : "Not yet run"}</p>
        </div>
        <button className="button button--secondary" onClick={load}><RefreshCw size={16} /> Refresh status</button>
      </section>

      <section className="admin-health-grid">
        <StatusDot ok={health.database} label="Database" detail={health.database ? "Connected" : "Disconnected"} />
        <StatusDot ok={health.api} label="API Server" detail={health.api ? "Online" : "Offline"} />
        <StatusDot ok={health.email} label="Email Service" detail={health.email ? "Operational" : "Not configured"} />
        <StatusDot ok={health.auth} label="Authentication" detail={health.auth ? "Secure" : "Unavailable"} />
      </section>

      <section className="admin-panel">
        <h2>System Health</h2>
        <div className="admin-overview-grid">
          <article><span>Backend status</span><strong>{health.api ? "Online" : "Offline"}</strong></article>
          <article><span>Database status</span><strong>{health.database ? "Connected" : "Disconnected"}</strong></article>
          <article><span>Email status</span><strong>{health.email ? "Operational" : "Not configured"}</strong></article>
          <article><span>Authentication</span><strong>{health.auth ? "Secure" : "Unavailable"}</strong></article>
          <article><span>Synchronization</span><strong>{latestSync?.status === "success" ? "Up to date" : latestSync ? "Needs attention" : "Not run"}</strong></article>
          <article><span>Checked at</span><strong>{formatAdminDateTime(health.checkedAt)}</strong></article>
        </div>
      </section>
    </div>
  );
}
