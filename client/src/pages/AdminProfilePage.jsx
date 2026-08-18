import { useCallback, useEffect, useState } from "react";
import { KeyRound, Pencil, Save } from "lucide-react";
import { api } from "../api";
import { ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { adminInitials, formatAdminDateTime } from "../adminUtils";
import { useAuth } from "../useAuth";

export function AdminProfilePage() {
  const { updateUser } = useAuth();
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState(null);
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await api.getAdminProfile();
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
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.updateAdminProfile(form);
      setProfile(response.profile);
      setForm(response.profile);
      updateUser((current) => ({ ...current, ...response.profile, role: "admin" }));
      setSuccess("Profile updated.");
      setEditing(false);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  }

  async function savePassword(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (passwords.newPassword !== passwords.confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    try {
      const response = await api.updateAdminPassword({
        currentPassword: passwords.currentPassword,
        newPassword: passwords.newPassword,
      });
      setPasswords({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setSuccess(response.message);
    } catch (passwordError) {
      setError(passwordError.message);
    }
  }

  if (error && !profile) return <ErrorState message={error} onRetry={load} />;
  if (!profile || !form) return <LoadingState label="Loading administrator profile…" />;

  return (
    <div className="admin-page">
      <SectionHeading eyebrow="Your account" title="Admin Profile" detail="Manage your administrator contact details and password." />
      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}
      {success ? <p className="inline-alert inline-alert--success">{success}</p> : null}

      <section className="admin-profile-card">
        <div className="admin-profile-card__hero">
          <span className="admin-profile-card__avatar">{adminInitials(profile)}</span>
          <div>
            <span className="eyebrow eyebrow--light">Administrator</span>
            <h2>{profile.fullName}</h2>
            <p>{profile.email}</p>
          </div>
        </div>
        <div className="admin-profile-card__details">
          <article>
            <small>Phone</small>
            <strong>{profile.phone || "No phone on file"}</strong>
          </article>
          <article>
            <small>Role</small>
            <strong>{profile.role}</strong>
          </article>
          <article>
            <small>Created</small>
            <strong>{formatAdminDateTime(profile.createdAt, "—")}</strong>
          </article>
        </div>
        <div className="admin-profile-actions">
          <button type="button" className="button button--light" onClick={() => setEditing(true)}>
            <Pencil size={16} /> Edit Profile
          </button>
        </div>
      </section>

      {editing ? (
        <form className="admin-panel" onSubmit={saveProfile}>
          <h2>Edit Profile</h2>
          <div className="field-grid field-grid--two">
            <label className="field"><span>First Name</span><input value={form.firstName} onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))} required /></label>
            <label className="field"><span>Last Name</span><input value={form.lastName} onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))} required /></label>
            <label className="field"><span>Email</span><input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} required /></label>
            <label className="field"><span>Phone</span><input value={form.phone || ""} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} required /></label>
          </div>
          <div className="admin-modal__actions">
            <button type="button" className="button button--secondary" onClick={() => { setForm(profile); setEditing(false); }}>Cancel</button>
            <button className="button button--primary" disabled={busy}><Save size={16} /> {busy ? "Saving…" : "Save"}</button>
          </div>
        </form>
      ) : null}

      <form className="admin-panel" onSubmit={savePassword}>
        <h2><KeyRound size={18} /> Change Password</h2>
        <div className="field-grid field-grid--two">
          <label className="field"><span>Current Password</span><input type="password" value={passwords.currentPassword} onChange={(event) => setPasswords((current) => ({ ...current, currentPassword: event.target.value }))} required /></label>
          <label className="field"><span>New Password</span><input type="password" minLength="10" value={passwords.newPassword} onChange={(event) => setPasswords((current) => ({ ...current, newPassword: event.target.value }))} required /></label>
          <label className="field"><span>Confirm New Password</span><input type="password" minLength="10" value={passwords.confirmPassword} onChange={(event) => setPasswords((current) => ({ ...current, confirmPassword: event.target.value }))} required /></label>
        </div>
        <button className="button button--secondary">Update Password</button>
      </form>
    </div>
  );
}
