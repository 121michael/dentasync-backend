import { useCallback, useEffect, useState } from "react";
import { Trash2, UserPlus, Users } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, SectionHeading } from "../components/UI";

const ELIGIBILITY_OPTIONS = [
  { value: "toddler", label: "Toddler (under 3)" },
  { value: "child_under_12", label: "Child under 12" },
  { value: "pwd", label: "Person with disability (PWD) needing account help" },
  { value: "senior", label: "Senior needing account help" },
  { value: "other_authorized", label: "Other authorized patient unable to manage an account" },
];

function eligibilityLabel(value) {
  return ELIGIBILITY_OPTIONS.find((option) => option.value === value)?.label || value || "Dependent";
}

export function FamilyPage() {
  const [dependents, setDependents] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    email: "",
    phone: "",
    eligibilityCategory: "child_under_12",
  });

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

  async function addDependent(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.addDependent({
        email: form.email.trim(),
        phone: form.phone.trim(),
        eligibilityCategory: form.eligibilityCategory,
      });
      setSuccess(response.message || "Authorized dependent linked successfully.");
      setForm({ email: "", phone: "", eligibilityCategory: "child_under_12" });
      await load();
    } catch (addError) {
      setError(addError.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeDependent(dependent) {
    const label = dependent.fullName || dependent.name || dependent.email || "this dependent";
    if (!window.confirm(`Remove ${label} from your authorized dependents list?`)) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await api.removeDependent(dependent.id || dependent.dependentUserId);
      setSuccess("Dependent removed.");
      await load();
    } catch (removeError) {
      setError(removeError.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !dependents) return <ErrorState message={error} onRetry={load} />;
  if (!dependents) return <LoadingState label="Loading authorized dependents" />;

  return (
    <div className="family-page">
      <SectionHeading
        eyebrow="Authorized care management"
        title="Family & dependents"
        detail="Link eligible patients who cannot independently create or manage a DentaSync account — such as toddlers, children under 12, eligible PWDs, and seniors needing assistance. Being a relative alone is not enough."
      />

      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}
      {success ? <p className="inline-alert inline-alert--success">{success}</p> : null}

      <section className="glass-card booking-section">
        <div className="card-heading">
          <div>
            <span className="eyebrow">Add dependent</span>
            <h2>Authorize an eligible patient</h2>
          </div>
          <UserPlus className="card-heading__icon" size={21} />
        </div>
        <p className="muted-copy">
          The dependent must already have a patient account. You become their authorized account manager
          for booking and permitted records only.
        </p>
        <form className="admin-form" onSubmit={addDependent}>
          <label className="field">
            <span>Eligibility reason</span>
            <select
              required
              value={form.eligibilityCategory}
              onChange={(event) =>
                setForm((current) => ({ ...current, eligibilityCategory: event.target.value }))
              }
            >
              {ELIGIBILITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="field-row">
            <label className="field">
              <span>Dependent email</span>
              <input
                type="email"
                required
                value={form.email}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                placeholder="dependent@email.com"
              />
            </label>
            <label className="field">
              <span>Dependent phone</span>
              <input
                required
                value={form.phone}
                onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
                placeholder="09xxxxxxxxx"
              />
            </label>
          </div>
          <button className="button button--primary" disabled={busy}>
            {busy ? "Linking…" : "Add authorized dependent"}
          </button>
        </form>
      </section>

      <section className="glass-card booking-section">
        <div className="card-heading">
          <div>
            <span className="eyebrow">Linked accounts</span>
            <h2>Your authorized dependents</h2>
          </div>
          <Users className="card-heading__icon" size={21} />
        </div>

        {dependents.length ? (
          <div className="appointment-list">
            {dependents.map((dependent) => (
              <article className="appointment-row" key={dependent.id || dependent.dependentUserId}>
                <span className="status-pill status-pill--confirmed">
                  {eligibilityLabel(dependent.eligibilityCategory || dependent.relationship)}
                </span>
                <div>
                  <strong>{dependent.fullName || dependent.name || "Patient"}</strong>
                  <small>
                    {dependent.email || "No email"}
                    {dependent.phone ? ` · ${dependent.phone}` : ""}
                  </small>
                </div>
                <button
                  type="button"
                  className="icon-button icon-button--danger"
                  onClick={() => removeDependent(dependent)}
                  disabled={busy}
                  aria-label="Remove dependent"
                >
                  <Trash2 size={17} />
                </button>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No authorized dependents yet"
            detail="Add an eligible patient who cannot manage their own account using their registered email and phone."
          />
        )}
      </section>
    </div>
  );
}
