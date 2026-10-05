import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { AdminStatusBadge } from "../components/AdminUI";
import { useAdminUi } from "../components/AdminLayout";
import { formatAdminDateTime } from "../adminUtils";

export function AdminAuditPage() {
  const { pushToast } = useAdminUi();
  const [data, setData] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api.getAdminAuditLogs({ limit: 75 }));
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function runAudit() {
    try {
      const response = await api.runAdminSecurityAudit();
      setSummary(response.summary);
      pushToast(response.message || "Security audit completed.");
      await load();
    } catch (auditError) {
      pushToast(auditError.message, "error");
    }
  }

  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading security audit…" />;

  const logs = [...(data.logs || []), ...(data.loginActivity || [])]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 100);

  return (
    <div className="admin-page">
      <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">Accountability</span>
            <h2>Audit Log</h2>
            <p>
              Login activity, failed attempts, account changes, AI configuration updates, archive events,
              and synchronization actions.
            </p>
          </div>
          <div className="admin-heading-actions">
            <button className="button button--secondary" onClick={load}><RefreshCw size={16} /> Refresh</button>
            <button className="button button--primary" onClick={runAudit}>Run Security Audit</button>
          </div>
        </div>

        {summary ? (
          <div className="admin-overview-grid">
            <article><span>Failed logins (7d)</span><strong>{summary.failedLogins7d}</strong></article>
            <article><span>Login events (7d)</span><strong>{summary.loginEvents7d}</strong></article>
            <article><span>Admin actions (7d)</span><strong>{summary.adminActions7d}</strong></article>
          </div>
        ) : null}

        {logs.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>User</th>
                  <th>Role</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>IP / Session</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td>{formatAdminDateTime(log.timestamp)}</td>
                    <td><strong>{log.user}</strong></td>
                    <td className="capitalize">{log.role || "—"}</td>
                    <td>{log.action}</td>
                    <td>{log.target || "—"}</td>
                    <td>{log.ipAddress || log.sessionId || "—"}</td>
                    <td><AdminStatusBadge status={log.result || "success"} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No audit events yet" detail="Administrative actions will appear here as they occur." />
        )}
      </section>
    </div>
  );
}
