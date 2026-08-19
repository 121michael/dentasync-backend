import { useCallback, useEffect, useState } from "react";
import { Eye, Pencil, Plus, Search } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { AdminModal, AdminStatusBadge } from "../components/AdminUI";
import { useAdminUi } from "../components/AdminLayout";
import { formatAdminDate } from "../adminUtils";

const emptyForm = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  dateOfBirth: "",
  gender: "",
  address: "",
  notes: "",
};

export function AdminPatientRecordsPage() {
  const { pushToast, confirm } = useAdminUi();
  const [data, setData] = useState(null);
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.getAdminPatients({ search: applied, limit: 50 }));
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [applied]);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setFormOpen(true);
  }

  function openEdit(patient) {
    setEditing(patient);
    setForm({
      ...emptyForm,
      firstName: patient.firstName,
      lastName: patient.lastName,
      email: patient.email,
      phone: patient.phone,
      dateOfBirth: patient.dateOfBirth || "",
      gender: patient.gender || "",
    });
    setFormOpen(true);
  }

  async function savePatient(event) {
    event.preventDefault();
    setBusy(true);
    try {
      if (editing) {
        await api.updateAdminPatient(editing.id, form);
        pushToast("Patient information updated.");
      } else {
        const response = await api.createAdminPatient(form);
        pushToast(response.message || "Patient record created.");
      }
      setFormOpen(false);
      await load();
    } catch (saveError) {
      pushToast(saveError.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function viewPatient(patient) {
    try {
      setDetail((await api.getAdminPatient(patient.id)).patient);
    } catch (viewError) {
      pushToast(viewError.message, "error");
    }
  }

  async function archivePatient(patient) {
    const ok = await confirm({
      title: "Archive patient record",
      message: `Are you sure you want to archive ${patient.fullName}?`,
      confirmLabel: "Archive",
    });
    if (!ok) return;
    try {
      const response = await api.updateAdminAccountLifecycle(patient.id, "archive");
      pushToast(response.message || "Patient archived successfully.");
      await load();
    } catch (archiveError) {
      pushToast(archiveError.message, "error");
    }
  }

  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading patient records…" />;

  const patients = data.patients || [];

  return (
    <div className="admin-page">
      <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">Patient Search Registry Array</span>
            <h2>Patient Records Vault</h2>
            <p>Search clinical identities, review treatment history, and maintain protected patient records.</p>
          </div>
          <button className="button button--primary" onClick={openCreate}><Plus size={16} /> Add New Patient</button>
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

        {patients.length ? (
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
                {patients.map((patient) => (
                  <tr key={patient.id}>
                    <td><code>{patient.id}</code></td>
                    <td><strong>{patient.fullName}</strong><small>{patient.email}</small></td>
                    <td>{patient.phone || "—"}</td>
                    <td>{[patient.age ?? "—", patient.gender || "—"].join(" / ")}</td>
                    <td>{patient.lastTreatment || "—"}</td>
                    <td><AdminStatusBadge status={patient.verified ? patient.status : "pending"} /></td>
                    <td>
                      <div className="admin-row-actions">
                        <button className="button button--secondary button--compact" onClick={() => viewPatient(patient)}><Eye size={14} /> View</button>
                        <button className="button button--secondary button--compact" onClick={() => openEdit(patient)}><Pencil size={14} /> Edit</button>
                        <button className="button button--secondary button--compact" onClick={() => archivePatient(patient)}>Archive</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No patients found" detail="Add a patient or refine the registry search." />
        )}
      </section>

      {formOpen ? (
        <AdminModal title={editing ? "Edit patient" : "Add New Patient"} onClose={() => setFormOpen(false)} wide>
          <form className="admin-form" onSubmit={savePatient}>
            <label>First name<input required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></label>
            <label>Last name<input required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></label>
            <label>Email<input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <label>Phone<input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
            <label>Date of birth<input type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} /></label>
            <label>Gender<input value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })} /></label>
            <label>Address<textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
            <div className="admin-modal__actions">
              <button type="button" className="button button--secondary" onClick={() => setFormOpen(false)}>Cancel</button>
              <button className="button button--primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
            </div>
          </form>
        </AdminModal>
      ) : null}

      {detail ? (
        <AdminModal title="Patient profile" onClose={() => setDetail(null)} wide>
          <div className="admin-detail-grid">
            <p><small>Name</small><strong>{detail.fullName}</strong></p>
            <p><small>Email</small><strong>{detail.email}</strong></p>
            <p><small>Phone</small><strong>{detail.phone || "—"}</strong></p>
            <p><small>Status</small><strong className="capitalize">{detail.status}</strong></p>
          </div>
          <h3 className="admin-subheading">Appointment history</h3>
          <div className="admin-history-list">
            {(detail.appointments || []).length ? detail.appointments.map((appointment) => (
              <article key={appointment.id}>
                <div>
                  <strong>{appointment.treatment}</strong>
                  <small>{formatAdminDate(appointment.date)} · {appointment.dentist} · {appointment.status}</small>
                </div>
              </article>
            )) : <p className="muted-copy">No appointments on file.</p>}
          </div>
        </AdminModal>
      ) : null}
    </div>
  );
}
