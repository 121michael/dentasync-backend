import { useCallback, useEffect, useState } from "react";
import { Download, Eye, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { AdminModal, AdminStatusBadge } from "../components/AdminUI";
import { formatAdminDate, formatAdminTime } from "../adminUtils";

const emptyForm = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  password: "",
  specialization: "",
  scheduleNotes: "",
  dateOfBirth: "",
  gender: "",
  address: "",
  notes: "",
};

export function AdminUsersPage({ role }) {
  const title =
    role === "patient" ? "Patient Management" : role === "staff" ? "Staff Management" : "Dentist Management";
  const [data, setData] = useState(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [applied, setApplied] = useState({ search: "", status: "" });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [detail, setDetail] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const loader =
        role === "patient" ? api.getAdminPatients : role === "staff" ? api.getAdminStaff : api.getAdminDentists;
      setData(await loader(applied));
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [applied, role]);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setFormOpen(true);
  }

  function openEdit(user) {
    setEditing(user);
    setForm({
      ...emptyForm,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      specialization: user.specialization || "",
      scheduleNotes: user.scheduleNotes || "",
      status: user.status,
    });
    setFormOpen(true);
  }

  async function saveUser(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      if (editing) {
        const updater =
          role === "patient" ? api.updateAdminPatient : role === "staff" ? api.updateAdminStaff : api.updateAdminDentist;
        await updater(editing.id, form);
        setSuccess("Account updated.");
      } else {
        const creator =
          role === "patient" ? api.createAdminPatient : role === "staff" ? api.createAdminStaff : api.createAdminDentist;
        const response = await creator(form);
        setSuccess(response.message);
      }
      setFormOpen(false);
      await load();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(user) {
    const next = user.status === "active" ? "inactive" : "active";
    setError("");
    try {
      await api.updateAdminAccountStatus(user.id, { status: next });
      await load();
    } catch (statusError) {
      setError(statusError.message);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setError("");
    setSuccess("");
    try {
      await api.deleteAdminAccount(pendingDelete.id);
      setSuccess("Account archived.");
      setPendingDelete(null);
      await load();
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  async function viewPatient(user) {
    if (role !== "patient") {
      setDetail(user);
      return;
    }
    try {
      setDetail((await api.getAdminPatient(user.id)).patient);
    } catch (viewError) {
      setError(viewError.message);
    }
  }

  async function exportUsers() {
    try {
      await api.downloadAdminExport(role === "patient" ? "patients" : role === "staff" ? "staff" : "dentists");
    } catch (exportError) {
      setError(exportError.message);
    }
  }

  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label={`Loading ${title.toLowerCase()}…`} />;

  const users =
    (role === "patient" ? data.patients : role === "staff" ? data.staff : data.dentists) || [];

  return (
    <div className="admin-page">
      <SectionHeading
        eyebrow="Account operations"
        title={title}
        detail="Search, register, and manage clinic accounts with administrator authorization."
        action={
          <div className="admin-heading-actions">
            <button className="button button--secondary" onClick={exportUsers}><Download size={16} /> Export</button>
            <button className="button button--primary" onClick={openCreate}><Plus size={16} /> Add {role[0].toUpperCase() + role.slice(1)}</button>
          </div>
        }
      />

      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}
      {success ? <p className="inline-alert inline-alert--success">{success}</p> : null}

      <section className="admin-panel">
        <form
          className="admin-toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            setApplied({ search, status });
          }}
        >
          <label className="admin-search">
            <Search size={17} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${role}`} />
          </label>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="pending">Pending</option>
          </select>
          <button className="button button--secondary button--compact">Filter</button>
        </form>

        {users.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{role === "patient" ? "Patient ID" : role === "staff" ? "Staff ID" : "Dentist ID"}</th>
                  <th>{role === "patient" ? "Name" : role === "staff" ? "Staff Name" : "Dentist Name"}</th>
                  <th>{role === "patient" ? "Contact" : "Email"}</th>
                  {role === "dentist" ? <th>Specialization</th> : null}
                  {role === "dentist" ? <th>Schedule</th> : null}
                  {role === "staff" ? <th>Position</th> : null}
                  {role === "patient" ? <th>Last Visit</th> : null}
                  {role === "staff" ? <th>Phone</th> : null}
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td><code>{user.id}</code></td>
                    <td><strong>{user.fullName}</strong></td>
                    <td>{role === "patient" ? user.phone || user.email : user.email}</td>
                    {role === "dentist" ? <td>{user.specialization || "General dentistry"}</td> : null}
                    {role === "dentist" ? <td>{user.scheduleNotes || "—"}</td> : null}
                    {role === "staff" ? <td>{user.position || "Clinic Staff"}</td> : null}
                    {role === "patient" ? <td>{formatAdminDate(user.lastVisit, "No visits yet")}</td> : null}
                    {role === "staff" ? <td>{user.phone || "—"}</td> : null}
                    <td><AdminStatusBadge status={user.verified ? user.status : "pending"} /></td>
                    <td>
                      <div className="admin-row-actions">
                        <button className="button button--secondary button--compact" onClick={() => viewPatient(user)}><Eye size={14} /> View</button>
                        <button className="button button--secondary button--compact" onClick={() => openEdit(user)}><Pencil size={14} /> Edit</button>
                        <button className="button button--secondary button--compact" onClick={() => toggleStatus(user)}>{user.status === "active" ? "Disable" : "Activate"}</button>
                        <button className="button button--danger button--compact" onClick={() => setPendingDelete(user)}><Trash2 size={14} /> Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No records found." detail="Try another search or register a new account." />
        )}
      </section>

      {formOpen ? (
        <AdminModal title={`${editing ? "Edit" : "Add"} ${role[0].toUpperCase() + role.slice(1)}`} onClose={() => setFormOpen(false)} wide>
          <form className="admin-form" onSubmit={saveUser}>
            <div className="field-grid field-grid--two">
              <label className="field"><span>First Name</span><input value={form.firstName} onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))} required /></label>
              <label className="field"><span>Last Name</span><input value={form.lastName} onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))} required /></label>
              <label className="field"><span>Email</span><input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} required /></label>
              <label className="field"><span>Phone</span><input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} required /></label>
              {!editing && role !== "patient" ? (
                <label className="field field--full"><span>Temporary Password <small>(optional, min 10)</small></span><input type="password" minLength="10" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} /></label>
              ) : null}
              {role === "dentist" ? (
                <>
                  <label className="field"><span>Specialization</span><input value={form.specialization} onChange={(event) => setForm((current) => ({ ...current, specialization: event.target.value }))} /></label>
                  <label className="field"><span>Schedule</span><input value={form.scheduleNotes} onChange={(event) => setForm((current) => ({ ...current, scheduleNotes: event.target.value }))} placeholder="Mon–Fri 9AM–5PM" /></label>
                </>
              ) : null}
              {role === "patient" && !editing ? (
                <>
                  <label className="field"><span>Date of Birth</span><input type="date" value={form.dateOfBirth} onChange={(event) => setForm((current) => ({ ...current, dateOfBirth: event.target.value }))} /></label>
                  <label className="field"><span>Gender</span><input value={form.gender} onChange={(event) => setForm((current) => ({ ...current, gender: event.target.value }))} /></label>
                  <label className="field field--full"><span>Address</span><input value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} /></label>
                  <label className="field field--full"><span>Notes</span><textarea rows="3" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label>
                </>
              ) : null}
              {editing ? (
                <label className="field">
                  <span>Status</span>
                  <select value={form.status || "active"} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>
              ) : null}
            </div>
            <div className="admin-modal__actions">
              <button type="button" className="button button--secondary" onClick={() => setFormOpen(false)}>Cancel</button>
              <button className="button button--primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
            </div>
          </form>
        </AdminModal>
      ) : null}

      {detail ? (
        <AdminModal title={detail.fullName || "Account details"} onClose={() => setDetail(null)} wide>
          <div className="admin-detail-grid">
            <p><strong>ID:</strong> {detail.id}</p>
            <p><strong>Email:</strong> {detail.email}</p>
            <p><strong>Phone:</strong> {detail.phone || "—"}</p>
            <p><strong>Status:</strong> {detail.status}</p>
            {detail.specialization ? <p><strong>Specialization:</strong> {detail.specialization}</p> : null}
            {detail.scheduleNotes ? <p><strong>Schedule:</strong> {detail.scheduleNotes}</p> : null}
            {detail.profile ? <p><strong>Address:</strong> {detail.profile.address || "—"}</p> : null}
          </div>
          {detail.appointments?.length ? (
            <div className="admin-history-list">
              {detail.appointments.map((appointment) => (
                <article key={appointment.id}>
                  <div>
                    <strong>{appointment.treatment}</strong>
                    <small>{appointment.dentist} · {formatAdminDate(appointment.date)} · {formatAdminTime(appointment.time)}</small>
                  </div>
                  <AdminStatusBadge status={appointment.status} />
                </article>
              ))}
            </div>
          ) : null}
        </AdminModal>
      ) : null}

      {pendingDelete ? (
        <AdminModal title="Delete Account?" onClose={() => setPendingDelete(null)}>
          <p className="admin-confirm-copy">
            Are you sure you want to delete this account? This action may affect associated records.
          </p>
          <div className="admin-modal__actions">
            <button type="button" className="button button--secondary" onClick={() => setPendingDelete(null)}>Cancel</button>
            <button type="button" className="button button--danger" onClick={confirmDelete}>Delete</button>
          </div>
        </AdminModal>
      ) : null}
    </div>
  );
}

export function AdminPatientsPage() {
  return <AdminUsersPage role="patient" />;
}

export function AdminStaffPage() {
  return <AdminUsersPage role="staff" />;
}

export function AdminDentistsPage() {
  return <AdminUsersPage role="dentist" />;
}
