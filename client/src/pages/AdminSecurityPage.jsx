import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { AdminModal, AdminStatusBadge } from "../components/AdminUI";
import { formatAdminDateTime } from "../adminUtils";

function loginStatus(eventType) {
  const value = String(eventType || "").toLowerCase();
  if (value.includes("fail")) return "failed";
  if (value.includes("success") || value.includes("login")) return "successful";
  return value || "unknown";
}

export function AdminSecurityPage() {
  const [security, setSecurity] = useState(null);
  const [accounts, setAccounts] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    try {
      const [securityResponse, accountsResponse] = await Promise.all([
        api.getAdminSecurity(),
        api.getAdminAccounts({ limit: 50 }),
      ]);
      setSecurity(securityResponse);
      setAccounts(accountsResponse);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleAccount(account) {
    const next = account.status === "active" ? "inactive" : "active";
    setBusyId(String(account.id));
    setError("");
    setSuccess("");
    try {
      await api.updateAdminAccountStatus(account.id, { status: next });
      setSuccess(`Account ${next === "active" ? "activated" : "disabled"}.`);
      await load();
    } catch (statusError) {
      setError(statusError.message);
    } finally {
      setBusyId("");
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setError("");
    setSuccess("");
    try {
      await api.deleteAdminAccount(pendingDelete.id);
      setSuccess("Account archived successfully.");
      setPendingDelete(null);
      await load();
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  if (error && !security) return <ErrorState message={error} onRetry={load} />;
  if (!security || !accounts) return <LoadingState label="Loading security controls…" />;

  return (
    <div className="admin-page">
      <SectionHeading
        eyebrow="Access control"
        title="Security / Access Control"
        detail="Login activity, role permissions, and account management."
      />
      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}
      {success ? <p className="inline-alert inline-alert--success">{success}</p> : null}

      <section className="admin-stat-grid admin-stat-grid--compact">
        <article className="admin-stat-card">
          <span>Password resets (7 days)</span>
          <strong>{security.passwordResets}</strong>
        </article>
        <article className="admin-stat-card">
          <span>Failed logins (7 days)</span>
          <strong>{security.failedAttempts}</strong>
        </article>
        <article className="admin-stat-card">
          <span>Tracked login events</span>
          <strong>{security.loginActivity.length}</strong>
        </article>
        <article className="admin-stat-card">
          <span>Managed accounts</span>
          <strong>{accounts.total}</strong>
        </article>
      </section>

      <section className="admin-panel">
        <h2>Role Permissions</h2>
        <div className="admin-history-list">
          {security.rolePermissions.map((item) => (
            <article key={item.role}>
              <div>
                <strong>{item.role}</strong>
                <small>{item.description}</small>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="admin-panel">
        <h2>Recent Login Activity</h2>
        {security.loginActivity.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Date / Time</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {security.loginActivity.map((entry) => (
                  <tr key={entry.id || `${entry.createdAt}-${entry.email}`}>
                    <td>
                      <strong>{entry.fullName || entry.email || "Unknown user"}</strong>
                      {entry.email ? <small>{entry.email}</small> : null}
                    </td>
                    <td>{entry.role || "—"}</td>
                    <td>{formatAdminDateTime(entry.createdAt)}</td>
                    <td><AdminStatusBadge status={loginStatus(entry.eventType)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No login activity recorded." detail="Authenticated portal activity will appear here." />
        )}
      </section>

      <section className="admin-panel">
        <h2>User Account Management</h2>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Created At</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {accounts.accounts.map((account) => (
                <tr key={account.id}>
                  <td><code>{account.id}</code></td>
                  <td>{account.fullName}</td>
                  <td>{account.email}</td>
                  <td>{account.role}</td>
                  <td><AdminStatusBadge status={account.verified ? account.status : "pending"} /></td>
                  <td>{formatAdminDateTime(account.createdAt)}</td>
                  <td>
                    <div className="admin-row-actions">
                      <button
                        className="button button--secondary button--compact"
                        disabled={busyId === String(account.id)}
                        onClick={() => toggleAccount(account)}
                      >
                        {account.status === "active" ? "Disable" : "Activate"}
                      </button>
                      <button
                        className="button button--danger button--compact"
                        onClick={() => setPendingDelete(account)}
                      >
                        <Trash2 size={14} /> Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {pendingDelete ? (
        <AdminModal title="Delete Account?" onClose={() => setPendingDelete(null)}>
          <p className="admin-confirm-copy">
            Are you sure you want to delete this account? This action may affect associated records.
          </p>
          <div className="admin-modal__actions">
            <button className="button button--secondary" onClick={() => setPendingDelete(null)}>Cancel</button>
            <button className="button button--danger" onClick={confirmDelete}>Delete</button>
          </div>
        </AdminModal>
      ) : null}
    </div>
  );
}
