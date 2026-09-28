import { useCallback, useEffect, useState } from "react";
import { Eye, Search } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { AdminModal, AdminStatusBadge } from "../components/AdminUI";
import { formatAdminDate } from "../adminUtils";

const ARCHIVE_ROLES = [
  { id: "staff", label: "Clinic Staff" },
  { id: "dentist", label: "Dentists" },
  { id: "patient", label: "Patients" },
];

function categoryLabel(value) {
  const raw = String(value || "").toLowerCase();
  if (raw === "senior" || raw === "senior_citizen") return "Senior";
  if (raw === "pediatric" || raw === "pediatric_patient") return "Pediatric";
  if (raw === "pwd") return "PWD";
  if (raw === "regular" || raw === "regular_patient") return "Regular";
  return value ? String(value) : "Regular";
}

export function AdminArchivedPage() {
  const [archiveRole, setArchiveRole] = useState("staff");
  const [data, setData] = useState(null);
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(
        await api.getAdminArchivedRecords({
          search: applied,
          role: archiveRole,
          limit: 50,
        })
      );
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [applied, archiveRole]);

  useEffect(() => {
    load();
  }, [load]);

  function selectArchiveRole(nextRole) {
    setArchiveRole(nextRole);
    setSearch("");
    setApplied("");
    setData(null);
  }

  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading archived records…" />;

  const heading =
    archiveRole === "staff"
      ? "Archived Clinic Staff"
      : archiveRole === "dentist"
        ? "Archived Dentists"
        : "Archived Patients";
  const records = data.records || [];

  return (
    <div className="admin-page">
      <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">Archive Records</span>
            <h2>{heading}</h2>
            <p>
              Archived accounts are read-only. Original details stay unchanged and related clinical records remain attached.
            </p>
          </div>
        </div>

        <div className="admin-tabs" role="tablist" aria-label="Archived records by category">
          {ARCHIVE_ROLES.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={archiveRole === item.id}
              className={`admin-tab ${archiveRole === item.id ? "is-active" : ""}`}
              onClick={() => selectArchiveRole(item.id)}
            >
              {item.label}
            </button>
          ))}
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
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={
                archiveRole === "patient"
                  ? "Search archived patients by name, email, or Patient ID"
                  : `Search archived ${archiveRole} accounts`
              }
            />
          </label>
          <button className="button button--secondary button--compact">Filter</button>
        </form>

        {records.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  {archiveRole === "patient" ? <th>Patient ID</th> : null}
                  <th>Name</th>
                  {archiveRole === "patient" ? <th>Category</th> : <th>Email</th>}
                  <th>Original Status</th>
                  <th>Archived Date</th>
                </tr>
              </thead>
              <tbody>
                {records.map((user) => (
                  <tr key={user.id}>
                    {archiveRole === "patient" ? (
                      <td><code>{user.patientId || user.id}</code></td>
                    ) : null}
                    <td><strong>{user.fullName}</strong></td>
                    {archiveRole === "patient" ? (
                      <td>{categoryLabel(user.patientCategory)}</td>
                    ) : (
                      <td>{user.email}</td>
                    )}
                    <td><AdminStatusBadge status={user.originalStatus || user.status} /></td>
                    <td>
                      <div className="admin-row-actions">
                        <span>{formatAdminDate(user.archivedAt)}</span>
                        <button className="button button--secondary button--compact" onClick={() => setDetail(user)}>
                          <Eye size={14} /> View
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={
              archiveRole === "patient"
                ? "No archived patients"
                : archiveRole === "dentist"
                  ? "No archived dentists"
                  : "No archived clinic staff"
            }
            detail="Archived accounts in this category will appear here."
          />
        )}
      </section>

      {detail ? (
        <AdminModal title="Archived record" onClose={() => setDetail(null)}>
          <div className="admin-detail-grid">
            <p><small>Name</small><strong>{detail.fullName}</strong></p>
            {detail.patientId ? <p><small>Patient ID</small><strong>{detail.patientId}</strong></p> : null}
            <p><small>System ID</small><strong>{detail.id}</strong></p>
            <p><small>Email</small><strong>{detail.email}</strong></p>
            <p><small>Phone</small><strong>{detail.phone || "—"}</strong></p>
            <p><small>Role</small><strong className="capitalize">{detail.role}</strong></p>
            {detail.patientCategory ? (
              <p><small>Category</small><strong>{categoryLabel(detail.patientCategory)}</strong></p>
            ) : null}
            <p><small>Original status</small><strong className="capitalize">{detail.originalStatus || detail.status}</strong></p>
            <p><small>Archived date</small><strong>{formatAdminDate(detail.archivedAt)}</strong></p>
          </div>
        </AdminModal>
      ) : null}
    </div>
  );
}
