import { useCallback, useEffect, useState } from "react";
import { Eye, Search } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { AdminModal, AdminStatusBadge } from "../components/AdminUI";
import { useAdminUi } from "../components/AdminLayout";
import { formatAdminDate } from "../adminUtils";

function formatMoney(value) {
  return `₱${Number(value || 0).toFixed(2)}`;
}

function formatHistoryDate(value) {
  if (!value) return "—";
  const text = typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : value;
  const date =
    typeof text === "string" && /^\d{4}-\d{2}-\d{2}$/.test(text)
      ? new Date(`${text}T00:00:00`)
      : new Date(text);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "2-digit",
    year: "numeric",
  }).format(date);
}

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
      pushToast(viewError.message || "Unable to load patient record.", "error");
    }
  }

  if (error && !data) {
    const needsMigration = /migrate:clinical-records/i.test(error);
    return (
      <ErrorState
        message={
          needsMigration
            ? "Patient records need a database update. In C:\\DentaSync-backend run: npm run migrate:clinical-records, then restart npm start."
            : error
        }
        onRetry={load}
      />
    );
  }
  if (!data) return <LoadingState label="Loading clinical patient records…" />;

  const records = data.records || [];
  const record = detail?.record;
  const appointments = detail?.appointments || [];
  const treatments = detail?.treatments || [];

  return (
    <div className="admin-page">
      <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">Patient Search Registry Array</span>
            <h2>Patient Records Vault</h2>
            <p>
              View-only patient information from the same clinical records used by dentists. Administrators can
              review details and treatment history, but cannot edit clinical data or access the dental chart.
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

        {data.setupRequired || data.message ? (
          <p className="inline-alert inline-alert--error" role="status">
            {data.message ||
              "Clinical tables are missing. In C:\\DentaSync-backend run: npm run migrate:clinical-records, then restart npm start."}
          </p>
        ) : null}

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
                {records.map((item) => (
                  <tr key={item.id}>
                    <td><code>{item.recordCode || item.id}</code></td>
                    <td>
                      <strong>{item.fullName}</strong>
                      <small>{item.email || "No linked portal account"}</small>
                    </td>
                    <td>{item.phone || "—"}</td>
                    <td>{[item.age ?? "—", item.gender || "—"].join(" / ")}</td>
                    <td>{item.lastTreatment || "—"}</td>
                    <td>
                      <AdminStatusBadge status={item.linkedUserId ? "linked_account" : "clinical_record"} />
                    </td>
                    <td>
                      <button className="button button--secondary button--compact" onClick={() => viewRecord(item)}>
                        <Eye size={14} /> View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No clinical records found"
            detail="Dentists and staff create clinical patient records from their portals."
          />
        )}
      </section>

      {detail && record ? (
        <AdminModal title="Patient Record" onClose={() => setDetail(null)} wide>
          <div className="admin-detail-grid">
            <p><small>Patient</small><strong>{record.fullName}</strong></p>
            <p><small>Patient ID</small><strong>{record.recordCode || record.id}</strong></p>
            <p><small>Date of Birth</small><strong>{formatHistoryDate(record.dateOfBirth)}</strong></p>
            <p><small>Sex</small><strong>{record.gender || "—"}</strong></p>
            <p><small>Contact</small><strong>{record.phone || "—"}</strong></p>
            <p><small>Email</small><strong>{record.email || "—"}</strong></p>
            <p><small>Address</small><strong>{record.address || "—"}</strong></p>
            <p><small>Linked account</small><strong>{record.linkedUserId || "None"}</strong></p>
            <p><small>Created by</small><strong className="capitalize">{record.createdByRole || "—"}</strong></p>
            <p><small>Notes</small><strong>{record.notes?.trim() ? record.notes : "—"}</strong></p>
          </div>

          <h3 className="admin-subheading">Appointments</h3>
          <div className="admin-history-list">
            {appointments.length ? (
              appointments.map((appointment) => (
                <article key={appointment.id}>
                  <div>
                    <strong>
                      {formatAdminDate(appointment.date)} · {appointment.time || "—"}
                    </strong>
                    <small>
                      {appointment.treatment || "Appointment"} · {appointment.status || "—"}
                      {appointment.dentist ? ` · ${appointment.dentist}` : ""}
                    </small>
                  </div>
                </article>
              ))
            ) : (
              <p className="muted-copy">No appointments on file for this patient.</p>
            )}
          </div>

          <h3 className="admin-subheading">Treatment History</h3>
          <p className="muted-copy">View only. Dentists maintain clinical treatment documentation on this same patient record.</p>
          <div className="admin-history-list">
            {treatments.length ? (
              treatments.map((treatment) => (
                <article key={treatment.id} className="admin-history-card">
                  <div className="admin-detail-grid">
                    <p>
                      <small>Date</small>
                      <strong>{formatHistoryDate(treatment.treatmentDate)}</strong>
                    </p>
                    <p>
                      <small>Procedure</small>
                      <strong>{treatment.treatment}</strong>
                    </p>
                    <p>
                      <small>Amount Charged</small>
                      <strong>{formatMoney(treatment.amountCharged)}</strong>
                    </p>
                    <p>
                      <small>Amount Paid</small>
                      <strong>{formatMoney(treatment.amountPaid)}</strong>
                    </p>
                  </div>
                  <small className="muted-copy">
                    {treatment.dentistName || "—"} · {treatment.status || "—"}
                    {treatment.toothNumber ? ` · Tooth ${treatment.toothNumber}` : ""}
                  </small>
                </article>
              ))
            ) : (
              <p className="muted-copy">No treatments on file.</p>
            )}
          </div>
        </AdminModal>
      ) : null}
    </div>
  );
}
