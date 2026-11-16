import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
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

  const load = useCallback(async () => {
    setError("");
    try {
      setPayload(await api.getAdminRecordAccessRequests());
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(requestId, decision) {
    setBusyId(`${requestId}:${decision}`);
    try {
      await api.decideAdminRecordAccess(requestId, decision);
      pushToast(decision === "approved" ? "Access granted for 30 minutes." : `Request ${decision}.`);
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
        <p className="eyebrow">Admin</p>
        <h1>Cross-Branch Access Requests</h1>
        <p>Approve, deny, or revoke read-only access. A grant lasts 30 minutes and does not allow edits.</p>
      </header>
      {!payload.requests.length ? (
        <EmptyState title="No requests" message="Dentists request access from Patient Records." />
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
                  <td>#{request.id}</td>
                  <td>{request.patientRecordId}</td>
                  <td>{request.requesterName || request.requesterId}</td>
                  <td>
                    {request.requestingBranchId} → {request.originatingBranchId}
                  </td>
                  <td>{request.scope}</td>
                  <td>{STATUS_LABEL[request.status] || request.status}</td>
                  <td>
                    {request.status === "pending" ? (
                      <>
                        <button type="button" disabled={Boolean(busyId)} onClick={() => decide(request.id, "approved")}>
                          Approve
                        </button>
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
                  </td>
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
