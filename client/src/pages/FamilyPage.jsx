import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { useAuth } from "../useAuth";

const RELATIONSHIP_OPTIONS = [
  { value: "child", label: "Child" },
  { value: "spouse", label: "Spouse" },
  { value: "parent", label: "Parent" },
  { value: "guardian", label: "Guardian" },
  { value: "other", label: "Other" },
];

const CATEGORY_OPTIONS = [
  { value: "regular", label: "Regular Patient" },
  { value: "senior", label: "Senior Citizen" },
  { value: "pediatric", label: "Pediatric Patient" },
  { value: "pwd", label: "PWD" },
];

const emptyForm = {
  firstName: "",
  middleName: "",
  lastName: "",
  birthdate: "",
  sex: "",
  phone: "",
  relationship: "child",
  patientCategory: "pediatric",
};

function relationshipLabel(value) {
  return RELATIONSHIP_OPTIONS.find((option) => option.value === value)?.label || value || "Dependent";
}

function statusLabel(value) {
  const status = String(value || "").toLowerCase();
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  return "Pending Approval";
}

function ageFromBirthdate(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const dob = new Date(`${value}T00:00:00`);
  if (Number.isNaN(dob.getTime())) return "";
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age -= 1;
  return age >= 0 ? String(age) : "";
}

export function FamilyPage() {
  const { startSession, actingAs, user } = useAuth();
  const navigate = useNavigate();
  const [dependents, setDependents] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [switchingId, setSwitchingId] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [viewing, setViewing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const calculatedAge = useMemo(() => ageFromBirthdate(form.birthdate), [form.birthdate]);

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await api.getDependents();
      setDependents(response.dependents || response.items || []);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function updateForm(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function addDependent(event) {
    event.preventDefault();
    if (!form.firstName.trim() || !form.lastName.trim() || !form.birthdate || !form.sex || !form.relationship) {
      setError("Please complete all required dependent fields before submitting.");
      return;
    }
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.addDependent({
        firstName: form.firstName.trim(),
        middleName: form.middleName.trim(),
        lastName: form.lastName.trim(),
        birthdate: form.birthdate,
        sex: form.sex,
        phone: form.phone.trim(),
        relationship: form.relationship,
        patientCategory: form.patientCategory,
      });
      setSuccess(response.message || "Your dependent registration is awaiting Admin approval.");
      setForm(emptyForm);
      setFormOpen(false);
      await load();
    } catch (addError) {
      setError(addError.message);
    } finally {
      setBusy(false);
    }
  }

  async function switchIntoDependent(dependent) {
    const dependentUserId = String(dependent.dependentUserId || dependent.userId || "").trim();
    if (!dependentUserId || String(dependent.approvalStatus || "").toLowerCase() !== "approved") {
      setError("Only approved dependents can be opened from this account.");
      return;
    }
    setSwitchingId(String(dependentUserId));
    setError("");
    setSuccess("");
    try {
      const response = await api.switchToDependent(dependentUserId);
      startSession(response.token, response.user, response.session);
      setSuccess(response.message || "Switched into dependent account.");
      navigate("/dashboard", { replace: true });
    } catch (switchError) {
      setError(switchError.message);
    } finally {
      setSwitchingId("");
    }
  }

  async function openDeleteDialog(dependent) {
    setError("");
    setSuccess("");
    let detail = dependent;
    try {
      const response = await api.getDependent(dependent.id);
      detail = { ...dependent, ...(response.dependent || {}) };
    } catch {
      detail = dependent;
    }
    setDeleting(detail);
  }

  async function confirmDeleteDependent() {
    if (!deleting) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.removeDependent(deleting.id, { confirmed: true });
      setSuccess(response.message || `${deleting.fullName} was removed from your family dependents.`);
      setDeleting(null);
      if (viewing?.id === deleting.id) setViewing(null);
      await load();
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setBusy(false);
    }
  }

  async function switchBackToPrincipal() {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.switchToPrincipal();
      startSession(response.token, response.user, response.session);
      setSuccess(response.message || "Switched back to your account.");
      await load();
    } catch (switchError) {
      setError(switchError.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !dependents) return <ErrorState message={error} onRetry={load} />;
  if (!dependents) return <LoadingState label="Loading dependents" />;

  return (
    <div className="family-page">
      <SectionHeading
        eyebrow="Family"
        title="Dependents"
        detail="Add children, a spouse, or other dependents to this existing account. They share your login and receive their own patient record after Admin approval."
      />

      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}
      {success ? <p className="inline-alert inline-alert--success">{success}</p> : null}

      {actingAs ? (
        <section className="glass-card booking-section account-switch-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Account switch</span>
              <h2>Viewing as {user?.fullName || "dependent"}</h2>
            </div>
            <ArrowLeftRight className="card-heading__icon" size={21} />
          </div>
          <p className="muted-copy">
            You are managing this dependent&apos;s patient record through your account. Switch back to add
            another dependent.
          </p>
          <button type="button" className="button button--primary" onClick={switchBackToPrincipal} disabled={busy}>
            {busy ? "Switching…" : "Switch back to my account"}
          </button>
        </section>
      ) : null}

      {!actingAs ? (
        <section className="glass-card booking-section">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Register under this account</span>
              <h2>My Dependents</h2>
            </div>
            <Users className="card-heading__icon" size={21} />
          </div>
          {!formOpen ? (
            <button type="button" className="button button--primary" onClick={() => setFormOpen(true)}>
              + Add Dependent
            </button>
          ) : (
            <form className="admin-form dependent-form" onSubmit={addDependent}>
              <p className="muted-copy">
                Submit the dependent&apos;s information for Admin approval. No separate login is created.
              </p>
              <div className="field-row">
                <label className="field">
                  <span>First Name</span>
                  <input name="firstName" required value={form.firstName} onChange={updateForm} />
                </label>
                <label className="field">
                  <span>Middle Name</span>
                  <input name="middleName" value={form.middleName} onChange={updateForm} />
                </label>
                <label className="field">
                  <span>Last Name</span>
                  <input name="lastName" required value={form.lastName} onChange={updateForm} />
                </label>
              </div>
              <div className="field-row">
                <label className="field">
                  <span>Birthdate</span>
                  <input name="birthdate" type="date" required value={form.birthdate} onChange={updateForm} />
                </label>
                <label className="field">
                  <span>Age</span>
                  <input value={calculatedAge} readOnly placeholder="Calculated from birthdate" />
                </label>
                <label className="field">
                  <span>Sex</span>
                  <select name="sex" required value={form.sex} onChange={updateForm}>
                    <option value="">Select</option>
                    <option>Female</option>
                    <option>Male</option>
                    <option>Non-binary</option>
                    <option>Prefer to self-describe</option>
                  </select>
                </label>
              </div>
              <div className="field-row">
                <label className="field">
                  <span>Phone Number</span>
                  <input name="phone" value={form.phone} onChange={updateForm} placeholder="Optional" />
                </label>
                <label className="field">
                  <span>Relationship to Account Holder</span>
                  <select name="relationship" required value={form.relationship} onChange={updateForm}>
                    {RELATIONSHIP_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Patient Category</span>
                  <select name="patientCategory" value={form.patientCategory} onChange={updateForm}>
                    {CATEGORY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="family-dependent-actions">
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => {
                    setFormOpen(false);
                    setForm(emptyForm);
                  }}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button className="button button--primary" disabled={busy}>
                  {busy ? "Submitting…" : "Submit for Approval"}
                </button>
              </div>
            </form>
          )}
        </section>
      ) : null}

      <section className="glass-card booking-section">
        <div className="card-heading">
          <div>
            <span className="eyebrow">Linked to your login</span>
            <h2>My Dependents</h2>
          </div>
        </div>

        {dependents.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table family-dependents-table">
              <thead>
                <tr>
                  <th>Dependent</th>
                  <th>Patient ID</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {dependents.map((dependent) => {
                  const status = String(dependent.approvalStatus || "pending").toLowerCase();
                  const canSwitch = status === "approved" && String(dependent.dependentUserId || "").trim();
                  return (
                    <tr key={dependent.id || dependent.dependentUserId}>
                      <td>
                        <strong>{dependent.fullName || dependent.name || "Dependent"}</strong>
                        <div><small>{relationshipLabel(dependent.relationship)}</small></div>
                      </td>
                      <td>{dependent.patientId || "—"}</td>
                      <td>
                        <span className={`status-pill status-pill--${status === "approved" ? "confirmed" : status === "rejected" ? "cancelled" : "pending"}`}>
                          {statusLabel(status)}
                        </span>
                        {status === "pending" ? (
                          <p className="muted-copy family-pending-note">
                            Your dependent registration is awaiting Admin approval.
                          </p>
                        ) : null}
                      </td>
                      <td>
                        <div className="family-dependent-actions">
                          <button
                            type="button"
                            className="button button--secondary button--compact"
                            onClick={() => setViewing(dependent)}
                          >
                            View
                          </button>
                          {canSwitch ? (
                            <button
                              type="button"
                              className="button button--secondary button--compact"
                              onClick={() => switchIntoDependent(dependent)}
                              disabled={busy || switchingId === String(dependent.dependentUserId)}
                            >
                              {switchingId === String(dependent.dependentUserId) ? "Switching…" : "Open records"}
                            </button>
                          ) : null}
                          {!actingAs ? (
                            <button
                              type="button"
                              className="button button--danger button--compact"
                              onClick={() => openDeleteDialog(dependent)}
                              disabled={busy}
                            >
                              Delete Account
                            </button>
                          ) : null}
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
            title="No dependents yet"
            detail="Use + Add Dependent to register a family member under this account for Admin approval."
          />
        )}
      </section>

      {viewing ? (
        <section className="glass-card booking-section">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Dependent details</span>
              <h2>{viewing.fullName}</h2>
            </div>
            <button type="button" className="button button--secondary button--compact" onClick={() => setViewing(null)}>
              Close
            </button>
          </div>
          <div className="admin-detail-grid">
            <p><small>Relationship</small><strong>{relationshipLabel(viewing.relationship)}</strong></p>
            <p><small>Status</small><strong>{statusLabel(viewing.approvalStatus)}</strong></p>
            <p><small>Birthdate</small><strong>{viewing.dateOfBirth || "—"}</strong></p>
            <p><small>Age</small><strong>{viewing.age ?? "—"}</strong></p>
            <p><small>Sex</small><strong>{viewing.gender || "—"}</strong></p>
            <p><small>Phone</small><strong>{viewing.phone || "—"}</strong></p>
            <p><small>Category</small><strong>{viewing.patientCategory || "—"}</strong></p>
            <p><small>Patient ID</small><strong>{viewing.patientId || "Assigned after approval"}</strong></p>
          </div>
          {String(viewing.approvalStatus).toLowerCase() === "pending" ? (
            <p className="muted-copy">Your dependent registration is awaiting Admin approval. Appointment booking for this dependent stays unavailable until then.</p>
          ) : null}
        </section>
      ) : null}

      {deleting && !actingAs ? (
        <div className="admin-modal-backdrop" role="presentation" onMouseDown={() => !busy && setDeleting(null)}>
          <section
            className="admin-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-dependent-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="admin-modal__header">
              <h2 id="delete-dependent-title">Delete Dependent Account</h2>
              <button
                type="button"
                className="icon-button"
                onClick={() => setDeleting(null)}
                disabled={busy}
                aria-label="Close confirmation"
              >
                ×
              </button>
            </header>
            <p className="admin-confirm-copy">
              Are you sure you want to delete {deleting.fullName || "this dependent"} from your family dependents?
            </p>
            <p className="muted-copy">
              This will remove the dependent from your account and prevent further appointment bookings under this
              dependent. Completed appointments and dental records are kept.
            </p>
            {Array.isArray(deleting.upcomingAppointments) && deleting.upcomingAppointments.length ? (
              <p className="inline-alert inline-alert--error">
                {deleting.fullName} has {deleting.upcomingAppointments.length} upcoming appointment
                {deleting.upcomingAppointments.length === 1 ? "" : "s"}. Deleting this dependent will cancel
                {deleting.upcomingAppointments.length === 1 ? " that booking" : " those bookings"} using the clinic
                cancellation workflow.
              </p>
            ) : null}
            <div className="admin-modal__actions">
              <button type="button" className="button button--secondary" onClick={() => setDeleting(null)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="button button--danger" onClick={confirmDeleteDependent} disabled={busy}>
                {busy ? "Deleting…" : "Delete Account"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
