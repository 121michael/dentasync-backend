import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, KeyRound, Pencil, Plus, Search, ShieldCheck } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { AdminModal, AdminStatusBadge } from "../components/AdminUI";
import { useAdminUi } from "../components/AdminLayout";
import { formatAdminDate } from "../adminUtils";

const TABS = [
  { id: "staff", label: "Clinic Staff" },
  { id: "dentist", label: "Dentists" },
  { id: "patient", label: "Patients" },
];

const emptyForm = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  password: "",
  position: "Senior Desk Administrator",
  specialization: "",
  scheduleNotes: "",
  dateOfBirth: "",
  gender: "",
  address: "",
  notes: "",
};

export function AdminManageUsersPage() {
  const { pushToast, confirm } = useAdminUi();
  const [tab, setTab] = useState("staff");
  const [data, setData] = useState(null);
  const [pending, setPending] = useState([]);
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
      const loader =
        tab === "patient" ? api.getAdminPatients : tab === "staff" ? api.getAdminStaff : api.getAdminDentists;
      const [list, pendingResponse] = await Promise.all([
        loader({ search: applied, limit: 50 }),
        api.getAdminPendingRegistrations({ limit: 50 }),
      ]);
      setData(list);
      setPending(pendingResponse.requests || []);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [applied, tab]);

  useEffect(() => {
    load();
  }, [load]);

  const users = useMemo(() => {
    if (!data) return [];
    return (tab === "patient" ? data.patients : tab === "staff" ? data.staff : data.dentists) || [];
  }, [data, tab]);

  function openCreate() {
    setEditing(null);
    setForm({
      ...emptyForm,
      position: tab === "staff" ? "Chief Clinic Coordinator" : emptyForm.position,
    });
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
      position: user.operationalRole || user.position || "",
      specialization: user.specialization || "",
      scheduleNotes: user.scheduleNotes || "",
    });
    setFormOpen(true);
  }

  async function saveUser(event) {
    event.preventDefault();
    setBusy(true);
    try {
      if (editing) {
        const updater =
          tab === "patient" ? api.updateAdminPatient : tab === "staff" ? api.updateAdminStaff : api.updateAdminDentist;
        await updater(editing.id, form);
        pushToast("Account updated successfully.");
      } else {
        const creator =
          tab === "patient" ? api.createAdminPatient : tab === "staff" ? api.createAdminStaff : api.createAdminDentist;
        const response = await creator(form);
        pushToast(response.message || "Profile provisioned successfully.");
      }
      setFormOpen(false);
      await load();
    } catch (saveError) {
      pushToast(saveError.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function runLifecycle(user, action, message) {
    const ok = await confirm({
      title: "Confirm lifecycle action",
      message,
      confirmLabel: action[0].toUpperCase() + action.slice(1),
      tone: ["archive", "reject", "suspend"].includes(action) ? "danger" : "primary",
    });
    if (!ok) return;
    try {
      const response = await api.updateAdminAccountLifecycle(user.id, action);
      pushToast(response.message || "Account updated successfully.");
      await load();
    } catch (lifecycleError) {
      pushToast(lifecycleError.message, "error");
    }
  }

  async function resetPassword(user) {
    const ok = await confirm({
      title: "Reset password",
      message: `Issue a temporary password for ${user.fullName || user.email}?`,
      confirmLabel: "Reset password",
      tone: "primary",
    });
    if (!ok) return;
    try {
      const response = await api.resetAdminAccountPassword(user.id);
      pushToast(`Temporary password: ${response.temporaryPassword}`);
    } catch (resetError) {
      pushToast(resetError.message, "error");
    }
  }

  async function changeRole(user) {
    const role = window.prompt("New role (admin, dentist, staff, patient):", user.role);
    if (!role) return;
    try {
      const response = await api.updateAdminAccountRole(user.id, role.trim().toLowerCase());
      pushToast(response.message || "Role updated successfully.");
      await load();
    } catch (roleError) {
      pushToast(roleError.message, "error");
    }
  }

  async function approveRequest(request) {
    const ok = await confirm({
      title: "Approve registration",
      message: `Are you sure you want to approve ${request.fullName}?`,
      confirmLabel: "Approve",
      tone: "primary",
    });
    if (!ok) return;
    try {
      const response = await api.approveAdminRegistration(request.id);
      pushToast(response.message || "Account approved successfully.");
      await load();
    } catch (approveError) {
      pushToast(approveError.message, "error");
    }
  }

  async function rejectRequest(request) {
    const ok = await confirm({
      title: "Reject registration",
      message: `Are you sure you want to reject ${request.fullName}? Login access will be blocked.`,
      confirmLabel: "Reject",
    });
    if (!ok) return;
    try {
      const response = await api.rejectAdminRegistration(request.id);
      pushToast(response.message || "Registration rejected.");
      await load();
    } catch (rejectError) {
      pushToast(rejectError.message, "error");
    }
  }

  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading user accounts…" />;

  return (
    <div className="admin-page">
      <div className="admin-tabs" role="tablist" aria-label="Manage users by role">
        {TABS.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={tab === item.id}
            className={`admin-tab ${tab === item.id ? "is-active" : ""}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">Account operations</span>
            <h2>{tab === "staff" ? "Staff Accounts" : tab === "dentist" ? "Dentist Accounts" : "Patient Accounts"}</h2>
            <p>Provision, verify, and manage clinic identities with full lifecycle controls.</p>
          </div>
          <button className="button button--primary" onClick={openCreate}><Plus size={16} /> Provision Profile</button>
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
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${tab} accounts`} />
          </label>
          <button className="button button--secondary button--compact">Filter</button>
        </form>

        {users.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Account Name</th>
                  <th>System ID</th>
                  <th>{tab === "staff" ? "Operational Role" : tab === "dentist" ? "Specialization" : "Contact Endpoint"}</th>
                  <th>{tab === "patient" ? "Phone" : "Contact Endpoint"}</th>
                  <th>Operational Status</th>
                  <th>Lifecycle Action</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td><strong>{user.fullName}</strong></td>
                    <td><code>{user.id}</code></td>
                    <td>
                      {tab === "staff"
                        ? user.operationalRole || user.position || "Clinic Staff"
                        : tab === "dentist"
                          ? user.specialization || "General Dentistry"
                          : user.email}
                    </td>
                    <td>{tab === "patient" ? user.phone || "—" : user.email}</td>
                    <td>
                      <AdminStatusBadge status={!user.verified ? "pending" : user.status === "active" ? "operational" : user.status} />
                    </td>
                    <td>
                      <div className="admin-row-actions">
                        <button className="button button--secondary button--compact" onClick={() => setDetail(user)}><Eye size={14} /> View</button>
                        <button className="button button--secondary button--compact" onClick={() => openEdit(user)}><Pencil size={14} /> Edit</button>
                        <button className="button button--secondary button--compact" onClick={() => runLifecycle(user, "verify", `Verify ${user.fullName}?`)}><ShieldCheck size={14} /> Verify</button>
                        <button className="button button--secondary button--compact" onClick={() => runLifecycle(user, "approve", `Approve ${user.fullName}?`)}>Approve</button>
                        <button className="button button--secondary button--compact" onClick={() => runLifecycle(user, "reject", `Reject ${user.fullName}?`)}>Reject</button>
                        <button className="button button--secondary button--compact" onClick={() => runLifecycle(user, "suspend", `Suspend ${user.fullName}?`)}>Suspend</button>
                        <button className="button button--secondary button--compact" onClick={() => runLifecycle(user, "archive", `Are you sure you want to archive this account?`)}>Archive</button>
                        <button className="button button--secondary button--compact" onClick={() => changeRole(user)}>Role</button>
                        <button className="button button--secondary button--compact" onClick={() => resetPassword(user)}><KeyRound size={14} /> Reset</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No accounts found" detail="Provision a new profile or adjust your search filters." />
        )}
      </section>

      <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">Registration verification</span>
            <h2>Pending Registration Requests</h2>
            <p>Approve verified identities or reject requests to block protected dashboard access.</p>
          </div>
        </div>
        {pending.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Full Name</th>
                  <th>Email</th>
                  <th>Contact Number</th>
                  <th>Requested Role</th>
                  <th>Registration Date</th>
                  <th>Verification Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((request) => (
                  <tr key={request.id}>
                    <td><strong>{request.fullName}</strong></td>
                    <td>{request.email}</td>
                    <td>{request.phone || "—"}</td>
                    <td className="capitalize">{request.role}</td>
                    <td>{formatAdminDate(request.createdAt)}</td>
                    <td><AdminStatusBadge status={request.verified ? "verified" : "pending"} /></td>
                    <td>
                      <div className="admin-row-actions">
                        <button className="button button--primary button--compact" onClick={() => approveRequest(request)}>Approve</button>
                        <button className="button button--danger button--compact" onClick={() => rejectRequest(request)}>Reject</button>
                        <button className="button button--secondary button--compact" onClick={() => setDetail(request)}>View Details</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No pending registrations" detail="All registration requests have been reviewed." />
        )}
      </section>

      {formOpen ? (
        <AdminModal title={editing ? "Edit account" : "Provision Profile"} onClose={() => setFormOpen(false)} wide>
          <form className="admin-form" onSubmit={saveUser}>
            <label>First name<input required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></label>
            <label>Last name<input required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></label>
            <label>Email<input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <label>Phone<input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
            {!editing ? <label>Temporary password<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Optional" /></label> : null}
            {tab === "staff" ? (
              <label>Operational role
                <select value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })}>
                  <option>Chief Clinic Coordinator</option>
                  <option>Senior Desk Administrator</option>
                  <option>Clinic Staff</option>
                </select>
              </label>
            ) : null}
            {tab === "dentist" ? (
              <>
                <label>Specialization<input value={form.specialization} onChange={(e) => setForm({ ...form, specialization: e.target.value })} /></label>
                <label>Schedule notes<textarea value={form.scheduleNotes} onChange={(e) => setForm({ ...form, scheduleNotes: e.target.value })} /></label>
              </>
            ) : null}
            <div className="admin-modal__actions">
              <button type="button" className="button button--secondary" onClick={() => setFormOpen(false)}>Cancel</button>
              <button className="button button--primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
            </div>
          </form>
        </AdminModal>
      ) : null}

      {detail ? (
        <AdminModal title="Account details" onClose={() => setDetail(null)}>
          <div className="admin-detail-grid">
            <p><small>Name</small><strong>{detail.fullName}</strong></p>
            <p><small>System ID</small><strong>{detail.id}</strong></p>
            <p><small>Email</small><strong>{detail.email}</strong></p>
            <p><small>Phone</small><strong>{detail.phone || "—"}</strong></p>
            <p><small>Role</small><strong className="capitalize">{detail.role}</strong></p>
            <p><small>Status</small><strong className="capitalize">{detail.status}</strong></p>
          </div>
        </AdminModal>
      ) : null}
    </div>
  );
}
