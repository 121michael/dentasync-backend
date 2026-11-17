import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { AdminStackCell } from "../components/AdminUI";
import { useAdminUi } from "../components/AdminLayout";

const STATUS_LABEL = {
  pending: "Pending",
  approved: "Approved",
  denied: "Denied",
  expired: "Expired",
  revoked: "Revoked",
};

export function AdminRecordAccessPage() {
  const { pushToast } = useAdminUi();
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [grantMinutes, setGrantMinutes] = useState(30);

  const load = useCallback(async () => {
    setError("");
    try {
      const [requests, settings] = await Promise.all([
        api.getAdminRecordAccessRequests(),
        api.getAdminRecordAccessSettings().catch(() => ({ grantMinutes: 30 })),
      ]);
      setPayload(requests);
      setGrantMinutes(Number(settings.grantMinutes) || 30);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveDuration(event) {
    event.preventDefault();
    try {
      const saved = await api.saveAdminRecordAccessSettings({ grantMinutes: Number(grantMinutes) });
      setGrantMinutes(saved.grantMinutes);
      pushToast(`New grants last ${saved.grantMinutes} minutes.`);
    } catch (saveError) {
      pushToast(saveError.message, "error");
    }
  }

  async function decide(requestId, decision) {
    setBusyId(`${requestId}:${decision}`);
    try {
      await api.decideAdminRecordAccess(requestId, decision);
      pushToast(decision === "revoked" ? "Access revoked." : `Request ${decision}.`);
      await load();
    } catch (decideError) {
      pushToast(decideError.message, "error");
    } finally {
      setBusyId("");
    }
  }

  if (error && !payload) return <ErrorState message={error} onRetry={load} />;
  if (!payload) return <LoadingState label="Loading cross-branch access requests…" />;

  return (
    <div className="admin-page">
      <header className="admin-page__header">
        <p className="eyebrow">Review and revoke</p>
        <h1>Cross-Branch Access Requests</h1>
        <p>
          This page reviews access activity and revokes active grants. Approval codes are entered on Authorize Record
          Access by an Admin or delegated dentist signed in with their own account in a separate browser profile. Do
          not type an approver password into the dentist session. Legacy pending requests stay listed until that
          verification.
        </p>
      </header>
      <form onSubmit={saveDuration} className="admin-card" style={{ marginBottom: "1.5rem" }}>
        <label>
          New grant duration (minutes)
          <input
            type="number"
            min={15}
            max={240}
            value={grantMinutes}
            onChange={(event) => setGrantMinutes(event.target.value)}
          />
        </label>
        <button className="button button--secondary" type="submit">Save duration</button>
      </form>
      {!payload.requests.length ? (
        <EmptyState title="No requests" message="Dentists authorize access from Patient Records." />
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Request</th>
                <th>Patient record</th>
                <th>Requester</th>
                <th>Branches</th>
                <th>Scope</th>
                <th>Status</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {payload.requests.map((request) => (
                <tr key={request.id}>
                  <AdminStackCell label="Request" primary>#{request.id}</AdminStackCell>
                  <AdminStackCell label="Patient record">{request.patientRecordId}</AdminStackCell>
                  <AdminStackCell label="Requester">{request.requesterName || request.requesterId}</AdminStackCell>
                  <AdminStackCell label="Branches">
                    {request.requestingBranchId} → {request.originatingBranchId}
                  </AdminStackCell>
                  <AdminStackCell label="Scope">{request.scope}</AdminStackCell>
                  <AdminStackCell label="Status">{STATUS_LABEL[request.status] || request.status}</AdminStackCell>
                  <AdminStackCell label="Decision" actions>
                    {request.status === "pending" ? (
                      <>
                        <span>Authorize at the requesting workstation.</span>
                        <button type="button" disabled={Boolean(busyId)} onClick={() => decide(request.id, "denied")}>
                          Deny
                        </button>
                      </>
                    ) : null}
                    {request.status === "approved" && request.grant?.status === "active" ? (
                      <button type="button" disabled={Boolean(busyId)} onClick={() => decide(request.id, "revoked")}>
                        Revoke
                      </button>
                    ) : null}
                    {request.decisions?.length ? (
                      <small>
                        {request.decisions.map((item) => item.action).join(", ")}
                      </small>
                    ) : null}
                  </AdminStackCell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <section>
        <h2>Access logs</h2>
        {!payload.accessLogs?.length ? (
          <p>No record-access log entries yet.</p>
        ) : (
          <ul>
            {payload.accessLogs.map((entry) => (
              <li key={entry.id}>
                {entry.action} · record {entry.patientRecordId || "—"} · {entry.actorRole || "user"} {entry.actorId || ""}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
