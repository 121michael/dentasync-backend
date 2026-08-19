import { useCallback, useEffect, useState } from "react";
import { Eye, RotateCcw, Search, Trash2 } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { AdminModal, AdminStatusBadge } from "../components/AdminUI";
import { useAdminUi } from "../components/AdminLayout";
import { formatAdminDateTime } from "../adminUtils";

export function AdminArchivedPage() {
  const { pushToast, confirm } = useAdminUi();
  const [data, setData] = useState(null);
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await api.getAdminArchivedRecords({ search: applied, limit: 50 }));
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [applied]);

  useEffect(() => {
    load();
  }, [load]);

  async function restore(record) {
    const ok = await confirm({
      title: "Restore record",
      message: `Restore ${record.fullName} to the active registry?`,
      confirmLabel: "Restore",
      tone: "primary",
    });
    if (!ok) return;
    try {
      const response = await api.updateAdminAccountLifecycle(record.id, "restore");
      pushToast(response.message || "User restored successfully.");
      await load();
    } catch (restoreError) {
      pushToast(restoreError.message, "error");
    }
  }

  async function permanentDelete(record) {
    const ok = await confirm({
      title: "Delete permanently",
      message: `Are you sure you want to permanently delete ${record.fullName}? This cannot be undone.`,
      confirmLabel: "Delete Permanently",
    });
    if (!ok) return;
    try {
      const response = await api.permanentlyDeleteAdminArchived(record.id);
      pushToast(response.message || "Record deleted permanently.");
      await load();
    } catch (deleteError) {
      pushToast(deleteError.message, "error");
    }
  }

  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading archived registry…" />;

  return (
    <div className="admin-page">
      <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">Vault storage</span>
            <h2>Archived Registry Vault</h2>
            <p>Restore archived identities or permanently remove authorized records.</p>
          </div>
        </div>

        <form
          className="admin-toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            setApplied(search);
          }}
        >
          <label className="admin-search">
            <Search size={17} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search archived records" />
          </label>
          <button className="button button--secondary button--compact">Search</button>
        </form>

        {data.records?.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Record ID</th>
                  <th>Name</th>
                  <th>Record Type</th>
                  <th>Archived Date</th>
                  <th>Archived By</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.records.map((record) => (
                  <tr key={record.id}>
                    <td><code>{record.id}</code></td>
                    <td><strong>{record.fullName}</strong><small>{record.email}</small></td>
                    <td className="capitalize">{record.recordType}</td>
                    <td>{formatAdminDateTime(record.archivedAt)}</td>
                    <td>{record.archivedByName || "Administrator"}</td>
                    <td><AdminStatusBadge status="archived" /></td>
                    <td>
                      <div className="admin-row-actions">
                        <button className="button button--secondary button--compact" onClick={() => setDetail(record)}><Eye size={14} /> View</button>
                        <button className="button button--primary button--compact" onClick={() => restore(record)}><RotateCcw size={14} /> Restore</button>
                        <button className="button button--danger button--compact" onClick={() => permanentDelete(record)}><Trash2 size={14} /> Delete Permanently</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Vault is empty" detail="No archived records are currently stored." />
        )}
      </section>

      {detail ? (
        <AdminModal title="Archived record" onClose={() => setDetail(null)}>
          <div className="admin-detail-grid">
            <p><small>Name</small><strong>{detail.fullName}</strong></p>
            <p><small>Email</small><strong>{detail.email}</strong></p>
            <p><small>Role</small><strong className="capitalize">{detail.role}</strong></p>
            <p><small>Archived</small><strong>{formatAdminDateTime(detail.archivedAt)}</strong></p>
          </div>
        </AdminModal>
      ) : null}
    </div>
  );
}
