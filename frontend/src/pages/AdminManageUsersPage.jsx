import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, Eye, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Navigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { AdminModal, AdminStatusBadge } from "../components/AdminUI";
import { useAdminUi } from "../components/AdminLayout";
import { formatAdminDate } from "../adminUtils";
import { matchesNotificationFocus } from "../notificationFocus";

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
};

function isPendingAccount(user) {
  const status = String(user?.status || "").toLowerCase();
  return !user?.verified || status === "pending" || status === "unverified";
}

function isRejectedAccount(user) {
  return String(user?.status || "").toLowerCase() === "rejected";
}

function isApprovedAccount(user) {
  const status = String(user?.status || "").toLowerCase();
  return Boolean(user?.verified) && (status === "active" || status === "operational");
}

function categoryLabel(value) {
  const raw = String(value || "").toLowerCase();
  if (raw === "senior" || raw === "senior_citizen") return "Senior";
  if (raw === "pediatric" || raw === "pediatric_patient") return "Pediatric";
  if (raw === "pwd") return "PWD";
  if (raw === "regular" || raw === "regular_patient") return "Regular";
  return value ? String(value) : "Regular";
}

function archiveCategoryLabel(tab) {
  if (tab === "staff") return "clinic staff";
  if (tab === "dentist") return "dentist";
  return "patient";
}

export function AdminManageUsersPage() {
  const { pushToast, confirm } = useAdminUi();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(() => {
    const urlTab = searchParams.get("tab");
    return TABS.some((item) => item.id === urlTab) ? urlTab : "staff";
  });
  const [data, setData] = useState(null);
  const [pending, setPending] = useState([]);
  const [pendingDependents, setPendingDependents] = useState([]);
  const [rejected, setRejected] = useState([]);
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [detail, setDetail] = useState(null);
  const [dependentDetail, setDependentDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionBusyId, setActionBusyId] = useState("");
  const [focusKey, setFocusKey] = useState(() => searchParams.get("focus") || "");
  const focusedRowRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const loader =
        tab === "patient" ? api.getAdminPatients : tab === "staff" ? api.getAdminStaff : api.getAdminDentists;
      const [list, pendingResponse, rejectedResponse, dependentsResponse] = await Promise.all([
        loader({ search: applied, limit: 50 }),
        api.getAdminPendingRegistrations({ limit: 50 }),
        api.getAdminRejectedRegistrations({ limit: 100 }),
        tab === "patient" ? api.getAdminPendingDependents().catch(() => ({ dependents: [] })) : Promise.resolve({ dependents: [] }),
      ]);
      setData(list);
      setPending((pendingResponse.requests || []).filter((request) => request.role === "patient"));
      setPendingDependents(dependentsResponse.dependents || dependentsResponse.requests || []);
      setRejected((rejectedResponse.requests || []).filter((request) => request.role === "patient"));
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

  useEffect(() => {
    const urlTab = searchParams.get("tab");
    if (urlTab && TABS.some((item) => item.id === urlTab) && urlTab !== tab) {
      setTab(urlTab);
    }
    const focus = searchParams.get("focus");
    if (focus) setFocusKey(focus);
  }, [searchParams, tab]);

  useEffect(() => {
    if (!focusKey) return;
    if (String(focusKey).startsWith("dependent:")) {
      const id = String(focusKey).slice("dependent:".length);
      const match = pendingDependents.find((item) => String(item.id) === id);
      if (match) setDependentDetail(match);
      return undefined;
    }
    if (!users.length) return;
    const match = users.find((user) =>
      matchesNotificationFocus(user, focusKey, ["id", "email", "phone", "patientId"])
    );
    if (!match) return;
    setDetail(match);
    const timer = window.setTimeout(() => {
      focusedRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    const clearTimer = window.setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      if (next.has("focus")) {
        next.delete("focus");
        setSearchParams(next, { replace: true });
      }
    }, 4000);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(clearTimer);
    };
  }, [focusKey, users, pendingDependents, searchParams, setSearchParams]);

  function selectTab(nextTab) {
    setTab(nextTab);
    setSearch("");
    setApplied("");
    setData(null);
    const next = new URLSearchParams(searchParams);
    next.set("tab", nextTab);
    setSearchParams(next, { replace: true });
  }

  function openCreate() {
    if (tab === "patient") {
      pushToast("Patients self-register. Approve pending requests below.", "warning");
      return;
    }
    setEditing(null);
    setForm({
      ...emptyForm,
      position: tab === "staff" ? "Chief Clinic Coordinator" : emptyForm.position,
    });
    setFormOpen(true);
  }

  function openEdit(user) {
    if (tab === "patient") {
      pushToast("Patient portal accounts are self-registered. Use Approve or Reject instead.", "warning");
      return;
    }
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
    if (tab === "patient") {
      pushToast("Administrators cannot create patient login accounts.", "error");
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        const updater = tab === "staff" ? api.updateAdminStaff : api.updateAdminDentist;
        await updater(editing.id, form);
        pushToast("Account updated successfully.");
      } else {
        const creator = tab === "staff" ? api.createAdminStaff : api.createAdminDentist;
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

  async function archiveUser(user) {
    const name = user.fullName || user.email;
    const category = archiveCategoryLabel(tab);
    const ok = await confirm({
      title: "Archive User",
      message: `Are you sure you want to archive ${name}? The ${category} record will be moved to Archive Records and will no longer appear in the active user list.`,
      confirmLabel: "Confirm Archive",
      tone: "danger",
    });
    if (!ok) return;
    setActionBusyId(`${user.id}:archive`);
    try {
      const response = await api.updateAdminAccountLifecycle(user.id, "archive");
      pushToast(response.message || `${name} was moved to Archive Records.`);
      await load();
    } catch (archiveError) {
      pushToast(archiveError.message || "Unable to archive this record.", "error");
    } finally {
      setActionBusyId("");
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
    setActionBusyId(`${user.id}:${action}`);
    try {
      const response = await api.updateAdminAccountLifecycle(user.id, action);
      pushToast(
        response.message ||
          (action === "approve"
            ? "Patient account approved successfully."
            : action === "reject"
              ? "Patient account rejected successfully."
              : "Account updated successfully.")
      );
      await load();
    } catch (lifecycleError) {
      pushToast(
        lifecycleError.message ||
          (action === "approve"
            ? "Unable to approve patient account."
            : action === "reject"
              ? "Unable to reject patient account."
              : `Unable to ${action} user.`),
        "error"
      );
    } finally {
      setActionBusyId("");
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
    setActionBusyId(`${request.id}:approve`);
    try {
      const response = await api.approveAdminRegistration(request.id);
      pushToast(response.message || "Patient account approved successfully.");
      await load();
    } catch (approveError) {
      pushToast(approveError.message || "Unable to approve patient account.", "error");
    } finally {
      setActionBusyId("");
    }
  }

  async function deletePendingRequest(request) {
    const ok = await confirm({
      title: "Permanently delete registration",
      message: `Delete ${request.fullName || request.email} completely? This cannot be undone. They can register again with the same email.`,
      confirmLabel: "Delete permanently",
      tone: "danger",
    });
    if (!ok) return;
    setActionBusyId(`${request.id}:purge`);
    try {
      const response = await api.permanentlyDeleteAdminArchived(request.id);
      pushToast(response.message || "Registration permanently deleted.");
      await load();
    } catch (deleteError) {
      pushToast(deleteError.message || "Unable to permanently delete this registration.", "error");
    } finally {
      setActionBusyId("");
    }
  }

  async function rejectRequest(request) {
    const ok = await confirm({
      title: "Reject registration",
      message: "Are you sure you want to reject this patient account?",
      confirmLabel: "Reject",
      tone: "danger",
    });
    if (!ok) return;
    setActionBusyId(`${request.id}:reject`);
    try {
      const response = await api.rejectAdminRegistration(request.id);
      pushToast(response.message || "Patient account rejected successfully.");
      await load();
    } catch (rejectError) {
      pushToast(rejectError.message || "Unable to reject patient account.", "error");
    } finally {
      setActionBusyId("");
    }
  }

  async function approveDependent(request) {
    setActionBusyId(`dep-${request.id}:approve`);
    try {
      const response = await api.approveAdminDependent(request.id);
      pushToast(response.message || "Dependent approved.");
      setDependentDetail(null);
      await load();
    } catch (approveError) {
      pushToast(approveError.message || "Unable to approve the dependent.", "error");
    } finally {
      setActionBusyId("");
    }
  }

  async function rejectDependent(request) {
    const ok = await confirm({
      title: "Reject dependent",
      message: `Reject ${request.fullName}? This request will stay rejected and the dependent will not become an active patient.`,
      confirmLabel: "Reject",
      tone: "danger",
    });
    if (!ok) return;
    setActionBusyId(`dep-${request.id}:reject`);
    try {
      const response = await api.rejectAdminDependent(request.id, { confirmed: true });
      pushToast(response.message || "Dependent request rejected.");
      setDependentDetail(null);
      await load();
    } catch (rejectError) {
      pushToast(rejectError.message || "Unable to reject the dependent.", "error");
    } finally {
      setActionBusyId("");
    }
  }

  if (searchParams.get("tab") === "archive") {
    return <Navigate to="/admin/archived-records" replace />;
  }

  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading user accounts…" />;

  const heading =
    tab === "staff" ? "Staff Accounts" : tab === "dentist" ? "Dentist Accounts" : "Patient Portal Accounts";

  return (
    <div className="admin-page">
      <div className="admin-tabs" role="tablist" aria-label="Manage users by role">
        {TABS.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={tab === item.id}
            className={`admin-tab ${tab === item.id ? "is-active" : ""}`}
            onClick={() => selectTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">Account operations</span>
            <h2>{heading}</h2>
            <p>
              {tab === "patient"
                ? "Patients create their own accounts. Approve them here so they can sign in, open the dashboard, and book appointments. Admin does not create patient accounts."
                : "Admin can create dentist and staff accounts only. Active accounts can be edited or archived."}
            </p>
          </div>
          {tab !== "patient" ? (
            <button className="button button--primary" onClick={openCreate}><Plus size={16} /> Provision Profile</button>
          ) : null}
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
                tab === "patient"
                  ? "Search patients by name, email, or Patient ID"
                  : `Search ${tab} accounts`
              }
            />
          </label>
          <button className="button button--secondary button--compact">Filter</button>
        </form>

        {users.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  {tab === "patient" ? <th>Patient ID</th> : null}
                  <th>{tab === "patient" ? "Name" : "Account Name"}</th>
                  {tab !== "patient" ? <th>System ID</th> : null}
                  {tab === "staff" ? <th>Operational Role</th> : null}
                  {tab === "dentist" ? <th>Specialization</th> : null}
                  {tab === "patient" ? <th>Phone</th> : null}
                  {tab !== "patient" ? <th>Contact Endpoint</th> : null}
                  <th>{tab === "patient" ? "Status" : "Operational Status"}</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const pendingUser = isPendingAccount(user);
                  const rejectedUser = isRejectedAccount(user);
                  const approvedUser = isApprovedAccount(user);
                  return (
                    <tr
                      key={user.id}
                      ref={matchesNotificationFocus(user, focusKey, ["id", "email", "phone", "patientId"]) ? focusedRowRef : null}
                      className={
                        matchesNotificationFocus(user, focusKey, ["id", "email", "phone", "patientId"])
                          ? "is-notification-focus"
                          : undefined
                      }
                    >
                      {tab === "patient" ? (
                        <td><code>{user.patientId || user.id}</code></td>
                      ) : null}
                      <td><strong>{user.fullName}</strong></td>
                      {tab !== "patient" ? <td><code>{user.id}</code></td> : null}
                      {tab === "staff" ? (
                        <td>{user.operationalRole || user.position || "Clinic Staff"}</td>
                      ) : null}
                      {tab === "dentist" ? (
                        <td>{user.specialization || "General Dentistry"}</td>
                      ) : null}
                      {tab === "patient" ? <td>{user.phone || "—"}</td> : null}
                      {tab !== "patient" ? <td>{user.email}</td> : null}
                      <td>
                        <AdminStatusBadge
                          status={
                            rejectedUser
                              ? "rejected"
                              : pendingUser
                                ? "pending"
                                : approvedUser
                                  ? "active"
                                  : user.status
                          }
                        />
                      </td>
                      <td>
                        <div className="admin-row-actions">
                          {tab === "patient" ? (
                            <>
                              <button className="button button--secondary button--compact" onClick={() => setDetail(user)}>
                                <Eye size={14} /> View
                              </button>
                              {pendingUser ? (
                                <>
                                  <button
                                    className="button button--primary button--compact"
                                    disabled={actionBusyId === `${user.id}:approve`}
                                    onClick={() =>
                                      runLifecycle(
                                        user,
                                        "approve",
                                        `Approve ${user.fullName} so they can open the patient dashboard and book appointments?`
                                      )
                                    }
                                  >
                                    Approve
                                  </button>
                                  <button
                                    className="button button--danger button--compact"
                                    disabled={actionBusyId === `${user.id}:reject`}
                                    onClick={() =>
                                      runLifecycle(user, "reject", "Are you sure you want to reject this patient account?")
                                    }
                                  >
                                    Reject
                                  </button>
                                </>
                              ) : null}
                              {approvedUser ? (
                                <button
                                  className="button button--secondary button--compact"
                                  onClick={() => runLifecycle(user, "suspend", `Suspend ${user.fullName}?`)}
                                >
                                  Suspend
                                </button>
                              ) : null}
                              <button
                                className="button button--secondary button--compact"
                                disabled={actionBusyId === `${user.id}:archive`}
                                onClick={() => archiveUser(user)}
                              >
                                <Archive size={14} /> Archive
                              </button>
                            </>
                          ) : (
                            <>
                              <button className="button button--secondary button--compact" onClick={() => openEdit(user)}>
                                <Pencil size={14} /> Edit
                              </button>
                              <button
                                className="button button--secondary button--compact"
                                disabled={actionBusyId === `${user.id}:archive`}
                                onClick={() => archiveUser(user)}
                              >
                                <Archive size={14} /> Archive
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={tab === "patient" ? "No patient portal accounts yet" : "No accounts found"}
            detail={
              tab === "patient"
                ? "Patients must register themselves. Approved accounts appear here."
                : "Provision a dentist or staff profile to get started."
            }
          />
        )}
      </section>

      {tab === "patient" ? (
        <>
          <section className="admin-panel">
            <div className="admin-panel__heading">
              <div>
                <span className="eyebrow">Registration verification</span>
                <h2>Pending Patient Registration Requests</h2>
                <p>
                  After OTP verification, patients wait here for admin approval. Once approved, they can sign in and
                  open the dashboard to create appointments.
                </p>
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
                            <button
                              className="button button--primary button--compact"
                              disabled={actionBusyId === `${request.id}:approve`}
                              onClick={() => approveRequest(request)}
                            >
                              Approve
                            </button>
                            <button
                              className="button button--danger button--compact"
                              disabled={actionBusyId === `${request.id}:reject`}
                              onClick={() => rejectRequest(request)}
                            >
                              Reject
                            </button>
                            <button
                              className="button button--danger button--compact"
                              disabled={actionBusyId === `${request.id}:purge`}
                              onClick={() => deletePendingRequest(request)}
                            >
                              <Trash2 size={14} /> Delete
                            </button>
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

          <section className="admin-panel">
            <div className="admin-panel__heading">
              <div>
                <span className="eyebrow">Dependent approval</span>
                <h2>Pending Dependent Requests</h2>
                <p>
                  Account holders submit dependents under their existing login. Approve to create a separate patient
                  record and Patient ID. Staff and dentists cannot approve these requests.
                </p>
              </div>
            </div>
            {pendingDependents.length ? (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Dependent Name</th>
                      <th>Relationship</th>
                      <th>Account Holder</th>
                      <th>Submitted Date</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingDependents.map((request) => (
                      <tr key={`dep-${request.id}`}>
                        <td><strong>{request.fullName}</strong></td>
                        <td className="capitalize">{request.relationship}</td>
                        <td>{request.accountHolderName || "—"}</td>
                        <td>{formatAdminDate(request.submittedAt || request.createdAt)}</td>
                        <td><AdminStatusBadge status="pending" /></td>
                        <td>
                          <div className="admin-row-actions">
                            <button className="button button--secondary button--compact" onClick={() => setDependentDetail(request)}>
                              View
                            </button>
                            <button
                              className="button button--primary button--compact"
                              disabled={actionBusyId === `dep-${request.id}:approve`}
                              onClick={() => approveDependent(request)}
                            >
                              Approve
                            </button>
                            <button
                              className="button button--danger button--compact"
                              disabled={actionBusyId === `dep-${request.id}:reject`}
                              onClick={() => rejectDependent(request)}
                            >
                              Reject
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No pending dependents" detail="Newly submitted dependents will appear here for Admin review." />
            )}
          </section>

          <section className="admin-panel">
            <div className="admin-panel__heading">
              <div>
                <span className="eyebrow">Rejected accounts</span>
                <h2>Rejected Patient Registrations</h2>
                <p>
                  Rejected accounts remain available for review. Newly rejected users are appended at the bottom of this list.
                </p>
              </div>
            </div>
            {rejected.length ? (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Full Name</th>
                      <th>Email</th>
                      <th>Contact Number</th>
                      <th>Rejected</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rejected.map((request) => (
                      <tr key={request.id}>
                        <td><strong>{request.fullName}</strong></td>
                        <td>{request.email}</td>
                        <td>{request.phone || "—"}</td>
                        <td>{formatAdminDate(request.statusChangedAt || request.createdAt)}</td>
                        <td><AdminStatusBadge status="rejected" /></td>
                        <td>
                          <div className="admin-row-actions">
                            <button className="button button--secondary button--compact" onClick={() => setDetail(request)}>View Details</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No rejected registrations" detail="Rejected patient accounts will appear here." />
            )}
          </section>
        </>
      ) : null}

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

      {dependentDetail ? (
        <AdminModal title="Dependent request" onClose={() => setDependentDetail(null)} wide>
          <div className="admin-detail-grid">
            <p><small>Dependent</small><strong>{dependentDetail.fullName}</strong></p>
            <p><small>Relationship</small><strong className="capitalize">{dependentDetail.relationship}</strong></p>
            <p><small>Account holder</small><strong>{dependentDetail.accountHolderName || "—"}</strong></p>
            <p><small>Holder email</small><strong>{dependentDetail.accountHolderEmail || "—"}</strong></p>
            <p><small>Holder Patient ID</small><strong>{dependentDetail.accountHolderPatientId || "—"}</strong></p>
            <p><small>Birthdate</small><strong>{dependentDetail.dateOfBirth || "—"}</strong></p>
            <p><small>Age</small><strong>{dependentDetail.age ?? "—"}</strong></p>
            <p><small>Sex</small><strong>{dependentDetail.gender || "—"}</strong></p>
            <p><small>Phone</small><strong>{dependentDetail.phone || "—"}</strong></p>
            <p><small>Category</small><strong>{categoryLabel(dependentDetail.patientCategory)}</strong></p>
            <p><small>Submitted</small><strong>{formatAdminDate(dependentDetail.submittedAt || dependentDetail.createdAt)}</strong></p>
            <p><small>Status</small><strong className="capitalize">{dependentDetail.approvalStatus}</strong></p>
          </div>
          {String(dependentDetail.approvalStatus).toLowerCase() === "pending" ? (
            <div className="admin-modal__actions">
              <button type="button" className="button button--secondary" onClick={() => setDependentDetail(null)}>Close</button>
              <button
                type="button"
                className="button button--danger"
                disabled={actionBusyId === `dep-${dependentDetail.id}:reject`}
                onClick={() => rejectDependent(dependentDetail)}
              >
                Reject
              </button>
              <button
                type="button"
                className="button button--primary"
                disabled={actionBusyId === `dep-${dependentDetail.id}:approve`}
                onClick={() => approveDependent(dependentDetail)}
              >
                Approve
              </button>
            </div>
          ) : null}
        </AdminModal>
      ) : null}
      {detail ? (
        <AdminModal title="Account details" onClose={() => setDetail(null)}>
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
            <p><small>Status</small><strong className="capitalize">{detail.status}</strong></p>
          </div>
        </AdminModal>
      ) : null}
    </div>
  );
}
