import { useCallback, useEffect, useState } from "react";
import { Eye, Pencil, Search } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { AdminModal, AdminStatusBadge } from "../components/AdminUI";
import { useAdminUi } from "../components/AdminLayout";
import { formatAdminDate } from "../adminUtils";
import { DentalChart } from "../components/DentalChart";

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

function toInputDate(value) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

const emptyEditForm = {
  treatmentId: "",
  treatmentDate: "",
  treatment: "",
  amountCharged: "0",
  amountPaid: "0",
};

export function AdminPatientRecordsPage() {
  const { pushToast } = useAdminUi();
  const [data, setData] = useState(null);
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);
  const [editingHistory, setEditingHistory] = useState(false);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [busy, setBusy] = useState(false);

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
      const response = await api.getAdminClinicalRecord(record.id);
      setDetail(response);
      setEditingHistory(false);
      setEditForm(emptyEditForm);
    } catch (viewError) {
      pushToast(viewError.message, "error");
    }
  }

  function startEditHistory() {
    const treatments = detail?.treatments || [];
    if (!treatments.length) {
      pushToast("No treatment history is available to edit.", "warning");
      return;
    }
    const selected = treatments[0];
    setEditForm({
      treatmentId: String(selected.id),
      treatmentDate: toInputDate(selected.treatmentDate),
      treatment: selected.treatment || "",
      amountCharged: String(selected.amountCharged ?? 0),
      amountPaid: String(selected.amountPaid ?? 0),
    });
    setEditingHistory(true);
  }

  function selectTreatmentForEdit(treatmentId) {
    const selected = (detail?.treatments || []).find((item) => String(item.id) === String(treatmentId));
    if (!selected) return;
    setEditForm({
      treatmentId: String(selected.id),
      treatmentDate: toInputDate(selected.treatmentDate),
      treatment: selected.treatment || "",
      amountCharged: String(selected.amountCharged ?? 0),
      amountPaid: String(selected.amountPaid ?? 0),
    });
  }

  async function saveTreatmentHistory(event) {
    event.preventDefault();
    if (!detail?.record?.id || !editForm.treatmentId) return;

    const procedure = editForm.treatment.trim();
    if (!procedure) {
      pushToast("Procedure cannot be empty.", "error");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(editForm.treatmentDate)) {
      pushToast("Date must be valid.", "error");
      return;
    }
    const amountCharged = Number(editForm.amountCharged);
    const amountPaid = Number(editForm.amountPaid);
    if (!Number.isFinite(amountCharged) || amountCharged < 0) {
      pushToast("Amount Charged must be a valid non-negative amount.", "error");
      return;
    }
    if (!Number.isFinite(amountPaid) || amountPaid < 0) {
      pushToast("Amount Paid must be a valid non-negative amount.", "error");
      return;
    }

    setBusy(true);
    try {
      const response = await api.updateAdminClinicalTreatment(detail.record.id, editForm.treatmentId, {
        treatment: procedure,
        treatmentDate: editForm.treatmentDate,
        amountCharged,
        amountPaid,
      });
      const refreshed = await api.getAdminClinicalRecord(detail.record.id);
      setDetail(refreshed);
      setEditingHistory(false);
      pushToast(response.message || "Treatment history updated successfully.");
    } catch (saveError) {
      pushToast(saveError.message || "Treatment history could not be updated.", "error");
    } finally {
      setBusy(false);
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
        <AdminModal
          title="Clinical patient record"
          onClose={() => {
            setDetail(null);
            setEditingHistory(false);
          }}
          wide
        >
          <div className="admin-detail-grid">
            <p><small>Name</small><strong>{detail.record.fullName}</strong></p>
            <p><small>Record code</small><strong>{detail.record.recordCode}</strong></p>
            <p><small>Email</small><strong>{detail.record.email || "—"}</strong></p>
            <p><small>Phone</small><strong>{detail.record.phone || "—"}</strong></p>
            <p><small>Created by</small><strong className="capitalize">{detail.record.createdByRole || "—"}</strong></p>
            <p><small>Linked account</small><strong>{detail.record.linkedUserId || "None"}</strong></p>
          </div>

          <h3 className="admin-subheading">2D Dental Chart</h3>
          <p className="muted-copy">
            Displays the dentist&apos;s saved clinical chart. Administrators can review treatments but cannot
            edit tooth conditions.
          </p>
          <DentalChart patientId={detail.record.id} readOnly />

          <h3 className="admin-subheading">Treatment History</h3>
          <div className="admin-history-list">
            {(detail.treatments || []).length ? (
              detail.treatments.map((treatment) => (
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

          <div className="admin-modal__actions" style={{ justifyContent: "flex-start", marginTop: "1rem" }}>
            <button
              type="button"
              className="button button--primary"
              onClick={startEditHistory}
              disabled={!(detail.treatments || []).length}
            >
              <Pencil size={14} /> Edit
            </button>
          </div>

          {editingHistory ? (
            <form className="admin-form" onSubmit={saveTreatmentHistory} style={{ marginTop: "1rem" }}>
              <h3 className="admin-subheading">Edit Treatment History</h3>
              {(detail.treatments || []).length > 1 ? (
                <label>
                  Select record
                  <select
                    value={editForm.treatmentId}
                    onChange={(event) => selectTreatmentForEdit(event.target.value)}
                  >
                    {(detail.treatments || []).map((treatment) => (
                      <option key={treatment.id} value={treatment.id}>
                        {formatAdminDate(treatment.treatmentDate)} — {treatment.treatment}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label>
                Date
                <input
                  required
                  type="date"
                  value={editForm.treatmentDate}
                  onChange={(event) => setEditForm((current) => ({ ...current, treatmentDate: event.target.value }))}
                />
              </label>
              <label>
                Procedure
                <input
                  required
                  value={editForm.treatment}
                  onChange={(event) => setEditForm((current) => ({ ...current, treatment: event.target.value }))}
                />
              </label>
              <label>
                Amount Charged
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={editForm.amountCharged}
                  onChange={(event) => setEditForm((current) => ({ ...current, amountCharged: event.target.value }))}
                />
              </label>
              <label>
                Amount Paid
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={editForm.amountPaid}
                  onChange={(event) => setEditForm((current) => ({ ...current, amountPaid: event.target.value }))}
                />
              </label>
              <div className="admin-modal__actions">
                <button type="button" className="button button--secondary" onClick={() => setEditingHistory(false)} disabled={busy}>
                  Cancel
                </button>
                <button className="button button--primary" disabled={busy}>
                  {busy ? "Saving…" : "Save"}
                </button>
              </div>
            </form>
          ) : null}
        </AdminModal>
      ) : null}
    </div>
  );
}
