import { useCallback, useEffect, useState } from "react";
import { Eye, Search } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { AdminModal, AdminStatusBadge } from "../components/AdminUI";
import { useAdminUi } from "../components/AdminLayout";
import { formatAdminDate } from "../adminUtils";

export function AdminPatientRecordsPage() {
  const { pushToast } = useAdminUi();
  const [data, setData] = useState(null);
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await api.getAdminClinicalRecords({ search: applied, limit: 50 }));
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [applied]);

  useEffect(() => {
    load();
  }, [load]);

  async function viewRecord(record) {
    try {
      setDetail(await api.getAdminClinicalRecord(record.id));
    } catch (viewError) {
      pushToast(viewError.message, "error");
    }
  }

  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading clinical patient records…" />;

  const records = data.records || [];

  return (
    <div className="admin-page">
      <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">Patient Search Registry Array</span>
            <h2>Patient Records Vault</h2>
            <p>
              View-only clinical records created by dentists and staff. These are not login accounts.
              Patients create their own portal accounts for admin approval.
            </p>
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
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search patient by name, ID, phone, or keyword"
            />
          </label>
          <button className="button button--secondary button--compact">Search</button>
        </form>

        {records.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Patient ID</th>
                  <th>Full Name</th>
                  <th>Contact Number</th>
                  <th>Age / Sex</th>
                  <th>Last Treatment</th>
                  <th>Record Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id}>
                    <td><code>{record.recordCode || record.id}</code></td>
                    <td><strong>{record.fullName}</strong><small>{record.email || "No linked portal account"}</small></td>
                    <td>{record.phone || "—"}</td>
                    <td>{[record.age ?? "—", record.gender || "—"].join(" / ")}</td>
                    <td>{record.lastTreatment || "—"}</td>
                    <td><AdminStatusBadge status={record.linkedUserId ? "linked_account" : "clinical_record"} /></td>
                    <td>
                      <button className="button button--secondary button--compact" onClick={() => viewRecord(record)}>
                        <Eye size={14} /> View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No clinical records found" detail="Dentists and staff create clinical patient records from their portals." />
        )}
      </section>

      {detail ? (
        <AdminModal title="Clinical patient record" onClose={() => setDetail(null)} wide>
          <div className="admin-detail-grid">
            <p><small>Name</small><strong>{detail.record.fullName}</strong></p>
            <p><small>Record code</small><strong>{detail.record.recordCode}</strong></p>
            <p><small>Email</small><strong>{detail.record.email || "—"}</strong></p>
            <p><small>Phone</small><strong>{detail.record.phone || "—"}</strong></p>
            <p><small>Created by</small><strong className="capitalize">{detail.record.createdByRole || "—"}</strong></p>
            <p><small>Linked account</small><strong>{detail.record.linkedUserId || "None"}</strong></p>
          </div>
          <h3 className="admin-subheading">Treatment history</h3>
          <div className="admin-history-list">
            {(detail.treatments || []).length ? detail.treatments.map((treatment) => (
              <article key={treatment.id}>
                <div>
                  <strong>{treatment.treatment}</strong>
                  <small>{formatAdminDate(treatment.treatmentDate)} · {treatment.dentistName || "—"} · {treatment.status}</small>
                </div>
              </article>
            )) : <p className="muted-copy">No treatments on file.</p>}
          </div>
          <p className="muted-copy">Administrators can view records only. Dentist and staff portals manage create/update/archive.</p>
        </AdminModal>
      ) : null}
    </div>
  );
}
