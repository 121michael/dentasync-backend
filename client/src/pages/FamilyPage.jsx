import { useCallback, useEffect, useState } from "react";
import { Trash2, UserPlus, Users } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, SectionHeading } from "../components/UI";

export function FamilyPage() {
  const [dependents, setDependents] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ email: "", phone: "" });

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
      });
      setSuccess(response.message || "Dependent linked successfully.");
      setForm({ email: "", phone: "" });
      await load();
    } catch (addError) {
      setError(addError.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeDependent(dependent) {
    const label = dependent.fullName || dependent.name || dependent.email || "this dependent";
    if (!window.confirm(`Remove ${label} from your family list?`)) return;
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
  if (!dependents) return <LoadingState label="Loading family accounts" />;

  return (
    <div className="family-page">
      <SectionHeading
        eyebrow="Family care"
        title="Family & dependents"
        detail="Link existing patient accounts so you can help manage appointments for dependents."
      />

      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}
      {success ? <p className="inline-alert inline-alert--success">{success}</p> : null}

      <section className="glass-card booking-section">
        <div className="card-heading">
          <div>
            <span className="eyebrow">Add dependent</span>
            <h2>Link an existing patient</h2>
          </div>
          <UserPlus className="card-heading__icon" size={21} />
        </div>
        <p className="muted-copy">
          Use the email and phone number already registered on the dependent&apos;s patient account.
        </p>
        <form className="admin-form" onSubmit={addDependent}>
          <div className="field-row">
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                required
                value={form.email}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                placeholder="dependent@email.com"
              />
            </label>
            <label className="field">
              <span>Phone</span>
              <input
                required
                value={form.phone}
                onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
                placeholder="09xxxxxxxxx"
              />
            </label>
          </div>
          <button className="button button--primary" disabled={busy}>
            {busy ? "Linking…" : "Add dependent"}
          </button>
        </form>
      </section>

      <section className="glass-card booking-section">
        <div className="card-heading">
          <div>
            <span className="eyebrow">Linked accounts</span>
            <h2>Your dependents</h2>
          </div>
          <Users className="card-heading__icon" size={21} />
        </div>

        {dependents.length ? (
          <div className="appointment-list">
            {dependents.map((dependent) => (
              <article className="appointment-row" key={dependent.id || dependent.dependentUserId}>
                <span className="status-pill status-pill--confirmed">
                  {dependent.relationship || "dependent"}
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
            title="No dependents linked yet"
            detail="Add a dependent with their registered email and phone to get started."
          />
        )}
      </section>
    </div>
  );
}
