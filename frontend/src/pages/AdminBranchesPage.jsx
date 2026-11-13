import { useCallback, useEffect, useState } from "react";
import { Building2, Pencil, Plus, Search } from "lucide-react";
import { api } from "../api";
import { formatAdminDateTime } from "../adminUtils";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { AdminModal, AdminStatusBadge } from "../components/AdminUI";
import { useAdminUi } from "../components/AdminLayout";

const emptyForm = {
  name: "",
  address: "",
  contactNumber: "",
  email: "",
};

function assignmentLabel(person) {
  return person.assignmentLabel || "Assigned";
}

export function AdminBranchesPage() {
  const { pushToast, confirm } = useAdminUi();
  const [branches, setBranches] = useState(null);
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [personnel, setPersonnel] = useState(null);

  const load = useCallback(async () => {
    try {
      const response = await api.getAdminBranches({ search: applied, status });
      setBranches(response.branches || []);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [applied, status]);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setFormOpen(true);
  }

  function openEdit(branch) {
    setEditing(branch);
    setForm({
      name: branch.name || "",
      address: branch.address || "",
      contactNumber: branch.contactNumber || "",
      email: branch.email || "",
    });
    setFormOpen(true);
  }

  async function saveBranch(event) {
    event.preventDefault();
    setBusy("save");
    try {
      const response = editing
        ? await api.updateAdminBranch(editing.id, form)
        : await api.createAdminBranch(form);
      pushToast(response.message || (editing ? "Branch updated." : "Branch created."));
      setFormOpen(false);
      await load();
    } catch (saveError) {
      pushToast(saveError.message, "error");
    } finally {
      setBusy("");
    }
  }

  async function changeStatus(branch, nextStatus) {
    const activating = nextStatus === "active";
    const ok = await confirm({
      title: activating ? "Activate branch" : "Deactivate branch",
      message: activating
        ? `Activate ${branch.name}? Staff and dentists can be assigned to it again.`
        : `Deactivate ${branch.name}? Existing staff and dentist assignments stay in place and are labeled inactive. Accounts and clinic records are not changed.`,
      confirmLabel: activating ? "Activate" : "Deactivate",
      tone: activating ? "primary" : "danger",
    });
    if (!ok) return;
    setBusy(`status-${branch.id}`);
    try {
      const response = await api.setAdminBranchStatus(branch.id, nextStatus);
      pushToast(response.message || "Branch status updated.");
      await load();
    } catch (statusError) {
      pushToast(statusError.message, "error");
    } finally {
      setBusy("");
    }
  }

  async function viewPersonnel(branch) {
    setBusy(`people-${branch.id}`);
    try {
      const response = await api.getAdminBranch(branch.id);
      setPersonnel(response.branch);
    } catch (viewError) {
      pushToast(viewError.message, "error");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="admin-page">
      <section className="admin-panel">
      <div className="admin-panel__heading">
        <div>
          <span className="eyebrow"><Building2 size={16} /> Branch Management</span>
          <h2>Clinic branches</h2>
          <p>Mandaluyong is the Main Branch. Add Pasig or another branch when the clinic is ready to open it.</p>
        </div>
        <button className="button button--primary" onClick={openCreate}><Plus size={16} /> Add branch</button>
      </div>

      <form
        className="admin-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied(search.trim());
        }}
      >
        <label className="admin-search">
          <Search size={17} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, ID, address, phone, or email"
          />
        </label>
        <label>
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        <button className="button button--secondary button--compact">Search</button>
      </form>

      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {!branches && !error ? <LoadingState label="Loading branches" /> : null}
      {branches && !branches.length ? (
        <EmptyState title="No branches match" message="Change the search or status filter, or add a branch." />
      ) : null}
      {branches?.length ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Branch ID</th>
                <th>Name</th>
                <th>Address</th>
                <th>Contact</th>
                <th>Email</th>
                <th>Main</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {branches.map((branch) => (
                <tr key={branch.id}>
                  <td><code>{branch.branchId}</code></td>
                  <td><strong>{branch.name}</strong></td>
                  <td>{branch.address || "Missing address"}</td>
                  <td>{branch.contactNumber || "Missing contact number"}</td>
                  <td>{branch.email || "No email"}</td>
                  <td>{branch.isMain ? "Main Branch" : "—"}</td>
                  <td><AdminStatusBadge status={branch.status} /></td>
                  <td>{formatAdminDateTime(branch.createdAt)}</td>
                  <td>
                    <div className="admin-row-actions">
                      <button type="button" className="button button--secondary button--compact" onClick={() => openEdit(branch)}>
                        <Pencil size={14} /> Edit
                      </button>
                      <button
                        type="button"
                        className="button button--secondary button--compact"
                        disabled={busy === `people-${branch.id}`}
                        onClick={() => viewPersonnel(branch)}
                      >
                        Assigned staff
                      </button>
                      {branch.isMain ? (
                        <span>Protected</span>
                      ) : (
                        <button
                          type="button"
                          className="button button--secondary button--compact"
                          disabled={busy === `status-${branch.id}`}
                          onClick={() => changeStatus(branch, branch.status === "active" ? "inactive" : "active")}
                        >
                          {branch.status === "active" ? "Deactivate" : "Activate"}
                        </button>
                      )}
                    </div>
                    {branch.missingDetails?.length ? (
                      <p className="admin-form--manage-user__error">Missing: {branch.missingDetails.join(", ")}</p>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {formOpen ? (
        <AdminModal title={editing ? "Edit branch" : "Add branch"} onClose={() => setFormOpen(false)}>
          <form className="admin-form" onSubmit={saveBranch}>
            {editing?.isMain ? <p>This is the Main Branch. It stays active and keeps the main designation.</p> : null}
            <label>
              Branch name
              <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </label>
            <label>
              Address
              <textarea required value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} />
            </label>
            <label>
              Contact number
              <input required value={form.contactNumber} onChange={(event) => setForm({ ...form, contactNumber: event.target.value })} />
            </label>
            <label>
              Email address
              <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="Optional" />
            </label>
            <div className="admin-modal__actions">
              <button type="button" className="button button--secondary" onClick={() => setFormOpen(false)}>Cancel</button>
              <button className="button button--primary" disabled={busy === "save"}>{editing ? "Save branch" : "Create branch"}</button>
            </div>
          </form>
        </AdminModal>
      ) : null}

      {personnel ? (
        <AdminModal title={`${personnel.name} assignments`} onClose={() => setPersonnel(null)} wide>
          <p>
            <code>{personnel.branchId}</code> · {personnel.status === "active" ? "Active" : "Inactive"}
            {personnel.isMain ? " · Main Branch" : ""}
          </p>
          {personnel.personnel?.length ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Email</th>
                    <th>Account</th>
                    <th>Assignment</th>
                  </tr>
                </thead>
                <tbody>
                  {personnel.personnel.map((person) => (
                    <tr key={person.id}>
                      <td>{person.fullName}</td>
                      <td className="capitalize">{person.role}</td>
                      <td>{person.email}</td>
                      <td className="capitalize">{person.accountStatus}</td>
                      <td>{assignmentLabel(person)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No assigned personnel" message="Staff and dentists assigned to this branch will appear here." />
          )}
        </AdminModal>
      ) : null}
      </section>
    </div>
  );
}
