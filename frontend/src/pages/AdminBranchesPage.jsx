import { useCallback, useEffect, useState } from "react";
import { Building2, Pencil, Plus, Search } from "lucide-react";
import { api } from "../api";
import { formatAdminDateTime } from "../adminUtils";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { AdminModal, AdminStatusBadge } from "../components/AdminUI";
import { useAdminUi } from "../components/AdminLayout";
import {
  applyBranchServerError,
  branchCheckLabel,
  branchContactLines,
  emptyBranchForm,
  formFromBranch,
  validateBranchForm,
} from "./adminBranchDisplay";

function BranchField({ id, label, hint, error, children }) {
  return (
    <label className={`field${error ? " field--warning" : ""}`} htmlFor={id}>
      <span>
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
      {children}
      {error ? (
        <p className="admin-form--branch__error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </label>
  );
}

function CheckInToggle({ id, label, checked, onChange }) {
  return (
    <label className="settings-toggle admin-form--branch__toggle" htmlFor={id}>
      <span>
        <span>
          <strong>{label}</strong>
          <small>{checked ? "On" : "Off"}</small>
        </span>
      </span>
      <input
        id={id}
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        onChange={onChange}
      />
      <i aria-hidden="true" />
    </label>
  );
}

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
  const [form, setForm] = useState(() => emptyBranchForm());
  const [fieldErrors, setFieldErrors] = useState({});
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

  function closeForm() {
    setFormOpen(false);
    setEditing(null);
    setForm(emptyBranchForm());
    setFieldErrors({});
  }

  function openCreate() {
    setEditing(null);
    setForm(emptyBranchForm());
    setFieldErrors({});
    setFormOpen(true);
  }

  function openEdit(branch) {
    setEditing(branch);
    setForm(formFromBranch(branch));
    setFieldErrors({});
    setFormOpen(true);
  }

  function updateField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
    setFieldErrors((current) => {
      if (!current[name] && !current.form) return current;
      const next = { ...current };
      delete next[name];
      delete next.form;
      return next;
    });
  }

  async function saveBranch(event) {
    event.preventDefault();
    const errors = validateBranchForm(form);
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      return;
    }
    setBusy("save");
    try {
      const response = editing
        ? await api.updateAdminBranch(editing.id, form)
        : await api.createAdminBranch(form);
      pushToast(response.message || (editing ? "Branch updated." : "Branch created."));
      closeForm();
      await load();
    } catch (saveError) {
      const mapped = applyBranchServerError(saveError.message);
      setFieldErrors(mapped);
      if (mapped.form) pushToast(saveError.message, "error");
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
      <div className="admin-panel__heading admin-branch-heading">
        <div>
          <span className="eyebrow"><Building2 size={16} /> Branch Management</span>
          <h2>Clinic branches</h2>
          <p>Mandaluyong is the Main Branch. Add Pasig or another branch when the clinic is ready to open it.</p>
        </div>
        <button className="button button--primary" onClick={openCreate}><Plus size={16} /> Add branch</button>
      </div>

      <form
        className="admin-toolbar admin-branch-toolbar"
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
            aria-label="Search branches"
          />
        </label>
        <label className="admin-branch-filter">
          <span>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status">
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
        <div className="admin-table-wrap admin-branch-list">
          <table className="admin-table admin-branch-table">
            <thead>
              <tr>
                <th>Branch</th>
                <th>Contact</th>
                <th>Status</th>
                <th>Check-in</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {branches.map((branch) => (
                <tr key={branch.id} className="admin-branch-card">
                  <td data-label="Branch">
                    <div className="admin-branch-identity">
                      <strong>{branch.name}</strong>
                      <code>{branch.branchId}</code>
                      {branch.isMain ? <span className="admin-branch-badge">Main Branch</span> : null}
                    </div>
                  </td>
                  <td data-label="Contact">
                    <ul className="admin-branch-contact">
                      {branchContactLines(branch).map((line, index) => (
                        <li key={`${branch.id}-contact-${index}`}>{line}</li>
                      ))}
                    </ul>
                  </td>
                  <td data-label="Status"><AdminStatusBadge status={branch.status} /></td>
                  <td data-label="Check-in">
                    <div className="admin-branch-checks">
                      <span className={`admin-branch-check ${branch.rfidEnabled ? "is-on" : "is-off"}`}>
                        {branchCheckLabel(branch.rfidEnabled, "RFID")}
                      </span>
                      <span className={`admin-branch-check ${branch.qrEnabled ? "is-on" : "is-off"}`}>
                        {branchCheckLabel(branch.qrEnabled, "QR")}
                      </span>
                    </div>
                  </td>
                  <td data-label="Created">{formatAdminDateTime(branch.createdAt)}</td>
                  <td data-label="Actions">
                    <div className="admin-branch-actions" role="group" aria-label={`Actions for ${branch.name}`}>
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
                        <span className="admin-branch-protected">Protected</span>
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
        <AdminModal
          title={editing ? "Edit branch" : "Add branch"}
          className="admin-modal--branch"
          onClose={closeForm}
        >
          <form className="admin-form admin-form--branch" onSubmit={saveBranch} noValidate>
            <div className="admin-form--branch__fields">
              {editing?.isMain ? (
                <p className="admin-form--branch__note">
                  This is the Main Branch. It stays active and keeps the main designation.
                </p>
              ) : null}
              {fieldErrors.form ? (
                <p className="admin-form--branch__error" role="alert">
                  {fieldErrors.form}
                </p>
              ) : null}
              <BranchField id="branch-name" label="Branch name" error={fieldErrors.name}>
                <input
                  id="branch-name"
                  value={form.name}
                  onChange={(event) => updateField("name", event.target.value)}
                  aria-invalid={Boolean(fieldErrors.name)}
                  aria-describedby={fieldErrors.name ? "branch-name-error" : undefined}
                  autoComplete="organization"
                />
              </BranchField>
              <BranchField id="branch-address" label="Address" error={fieldErrors.address}>
                <textarea
                  id="branch-address"
                  rows="4"
                  value={form.address}
                  onChange={(event) => updateField("address", event.target.value)}
                  aria-invalid={Boolean(fieldErrors.address)}
                  aria-describedby={fieldErrors.address ? "branch-address-error" : undefined}
                  autoComplete="street-address"
                />
              </BranchField>
              <div className="admin-form--branch__row">
                <BranchField id="branch-contact" label="Contact number" error={fieldErrors.contactNumber}>
                  <input
                    id="branch-contact"
                    value={form.contactNumber}
                    onChange={(event) => updateField("contactNumber", event.target.value)}
                    aria-invalid={Boolean(fieldErrors.contactNumber)}
                    aria-describedby={fieldErrors.contactNumber ? "branch-contact-error" : undefined}
                    autoComplete="tel"
                    inputMode="tel"
                  />
                </BranchField>
                <BranchField
                  id="branch-email"
                  label="Email address"
                  hint="optional"
                  error={fieldErrors.email}
                >
                  <input
                    id="branch-email"
                    type="email"
                    value={form.email}
                    onChange={(event) => updateField("email", event.target.value)}
                    aria-invalid={Boolean(fieldErrors.email)}
                    aria-describedby={fieldErrors.email ? "branch-email-error" : undefined}
                    autoComplete="email"
                    placeholder="Optional"
                  />
                </BranchField>
              </div>
              <fieldset className="admin-form--branch__methods">
                <legend>Check-in methods</legend>
                <CheckInToggle
                  id="branch-rfid"
                  label="RFID check-in"
                  checked={Boolean(form.rfidEnabled)}
                  onChange={(event) => updateField("rfidEnabled", event.target.checked)}
                />
                <CheckInToggle
                  id="branch-qr"
                  label="QR check-in"
                  checked={Boolean(form.qrEnabled)}
                  onChange={(event) => updateField("qrEnabled", event.target.checked)}
                />
              </fieldset>
            </div>
            <div className="admin-modal__actions">
              <button type="button" className="button button--secondary" onClick={closeForm}>
                Cancel
              </button>
              <button className="button button--primary" disabled={busy === "save"}>
                {editing ? "Save branch" : "Create branch"}
              </button>
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
