import { useCallback, useEffect, useState } from "react";
import { Save } from "lucide-react";
import { api } from "../api";
import { ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { dentistInitials, formatDentistDateTime } from "../dentistUtils";
import { useAuth } from "../useAuth";

export function DentistProfilePage() {
  const { updateUser } = useAuth();
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await api.getDentistProfile();
      setProfile(response.profile);
      setForm(response.profile);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.updateDentistProfile(form);
      setProfile(response.profile);
      setForm(response.profile);
      updateUser((current) => ({ ...current, ...response.profile, role: "dentist" }));
      setSuccess("Professional profile updated.");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !profile) return <ErrorState message={error} onRetry={load} />;
  if (!profile || !form) return <LoadingState label="Loading professional profile…" />;

  return (
    <div className="dentist-page">
      <SectionHeading
        eyebrow="Practitioner identity"
        title="Professional Profile"
        detail={formatDentistDateTime(new Date())}
      />

      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}
      {success ? <p className="inline-alert inline-alert--success">{success}</p> : null}

      <section className="dentist-profile-card">
        <span className="dentist-profile-card__avatar">{dentistInitials(profile)}</span>
        <div>
          <span className="eyebrow eyebrow--light">Operational credentials</span>
          <h2>{profile.fullName}</h2>
          <p>{profile.specialization || "Dental Specialist"}</p>
        </div>
      </section>

      <form className="dentist-panel" onSubmit={save}>
        <h2>Operational Credentials</h2>
        <div className="field-grid field-grid--two">
          <label className="field">
            <span>Full Practitioner Nomenclature Name</span>
            <input value={profile.fullName} readOnly />
          </label>
          <label className="field">
            <span>Assigned Medical Specialization Branch</span>
            <input
              value={form.specialization || ""}
              onChange={(event) => setForm((current) => ({ ...current, specialization: event.target.value }))}
              placeholder="Orthodontics and Dentofacial Orthopedics"
            />
          </label>
          <label className="field">
            <span>First Name</span>
            <input
              value={form.firstName || ""}
              onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>Last Name</span>
            <input
              value={form.lastName || ""}
              onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={form.email || ""}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>Phone</span>
            <input
              value={form.phone || ""}
              onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
              required
            />
          </label>
          <label className="field field--full">
            <span>Schedule Notes</span>
            <input
              value={form.scheduleNotes || ""}
              onChange={(event) => setForm((current) => ({ ...current, scheduleNotes: event.target.value }))}
              placeholder="Mon–Fri · 9:00 AM – 5:00 PM"
            />
          </label>
        </div>
        <button className="button button--primary" disabled={busy}>
          <Save size={16} /> {busy ? "Saving…" : "Save Profile"}
        </button>
      </form>
    </div>
  );
}
