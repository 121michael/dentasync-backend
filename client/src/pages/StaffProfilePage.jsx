import { useCallback, useEffect, useState } from "react";
import { Check, Mail, Pencil, Phone, Save, UserRound } from "lucide-react";
import { api } from "../api";
import { ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { staffInitials } from "../components/StaffUI";
import { useAuth } from "../useAuth";

export function StaffProfilePage() {
  const { updateUser } = useAuth();
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await api.getStaffProfile();
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

  async function saveProfile(event) {
    event.preventDefault();
    setIsSaving(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.updateStaffProfile(form);
      setProfile(response.profile);
      setForm(response.profile);
      updateUser((current) => ({ ...current, ...response.profile }));
      setSuccess("Profile settings saved.");
      setIsEditing(false);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setIsSaving(false);
    }
  }

  if (error && !profile) return <ErrorState message={error} onRetry={load} />;
  if (!profile || !form) return <LoadingState label="Loading your staff profile…" />;

  return (
    <div className="staff-page">
      <SectionHeading
        eyebrow="Your account"
        title="Profile"
        detail="Keep your staff contact details up to date."
      />

      {error && <p className="inline-alert inline-alert--error">{error}</p>}
      {success && <p className="inline-alert inline-alert--success"><Check size={17} /> {success}</p>}

      <section className="staff-profile-card">
        <div className="staff-profile-card__hero">
          <span className="staff-profile-card__avatar">{staffInitials(profile)}</span>
          <div>
            <span className="eyebrow eyebrow--light">Amethyst Dental Clinic</span>
            <h2>{profile.fullName}</h2>
            <p>{profile.role}</p>
          </div>
        </div>
        <div className="staff-profile-card__details">
          <article>
            <span className="staff-profile-card__icon"><Mail size={18} /></span>
            <div><small>Email</small><strong>{profile.email}</strong></div>
          </article>
          <article>
            <span className="staff-profile-card__icon"><Phone size={18} /></span>
            <div><small>Phone</small><strong>{profile.phone || "Not recorded"}</strong></div>
          </article>
          <article>
            <span className="staff-profile-card__icon"><UserRound size={18} /></span>
            <div><small>Account status</small><strong>{profile.accountStatus}</strong></div>
          </article>
        </div>
        <button className="button button--light" onClick={() => setIsEditing(true)}>
          <Pencil size={16} /> Edit Profile Settings
        </button>
      </section>

      {isEditing && (
        <form className="staff-panel staff-profile-form" onSubmit={saveProfile}>
          <div className="staff-panel__heading">
            <div>
              <span className="eyebrow">Profile settings</span>
              <h2>Edit contact information</h2>
              <p>Changes apply to your authenticated staff account.</p>
            </div>
          </div>
          <div className="field-grid field-grid--two">
            <label className="field"><span>First Name</span><input value={form.firstName} onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))} required /></label>
            <label className="field"><span>Last Name</span><input value={form.lastName} onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))} required /></label>
            <label className="field"><span>Email</span><input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} required /></label>
            <label className="field"><span>Phone</span><input value={form.phone || ""} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} required /></label>
          </div>
          <div className="staff-modal__actions">
            <button type="button" className="button button--secondary" onClick={() => { setForm(profile); setIsEditing(false); }}>Cancel</button>
            <button className="button button--primary" disabled={isSaving}>
              <Save size={16} /> {isSaving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
