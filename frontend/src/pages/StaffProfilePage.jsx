import { useCallback, useEffect, useState } from "react";
import { KeyRound, Save } from "lucide-react";
import { api } from "../api";
import { ErrorState, LoadingState } from "../components/UI";
import { StaffModal, StaffStatusBadge } from "../components/StaffUI";
import { useStaffUi } from "../components/StaffLayout";

export function StaffProfilePage() {
  const { pushToast } = useStaffUi();
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const load = useCallback(async () => {
    try {
      const response = await api.getStaffProfile();
      setProfile(response.profile);
      setForm({
        firstName: response.profile.firstName || "",
        lastName: response.profile.lastName || "",
        email: response.profile.email || "",
        phone: response.profile.phone || "",
      });
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
    setBusy("save");
    try {
      const response = await api.updateStaffProfile(form);
      setProfile(response.profile);
      pushToast("Profile updated successfully.");
    } catch (saveError) {
      pushToast(saveError.message, "error");
    } finally {
      setBusy("");
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      pushToast("New password confirmation does not match.", "error");
      return;
    }
    setBusy("password");
    try {
      const response = await api.updateStaffPassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      pushToast(response.message || "Password updated successfully.");
      setPasswordOpen(false);
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (passwordError) {
      pushToast(passwordError.message, "error");
    } finally {
      setBusy("");
    }
  }

  if (error && !profile) return <ErrorState message={error} onRetry={load} />;
  if (!profile || !form) return <LoadingState label="Loading professional profile…" />;

  return (
    <div className="staff-page">
      <section className="staff-panel">
        <div className="staff-panel__heading">
          <div>
            <span className="eyebrow">Account</span>
            <h2>Professional Profile</h2>
            <p>Update your permitted front-desk profile details and password.</p>
          </div>
          <StaffStatusBadge status={profile.accountStatus || "active"} />
        </div>

        <div className="staff-profile-hero">
          <div>
            <strong>{profile.fullName}</strong>
            <small>{profile.position || "Front Desk Coordinator"}</small>
          </div>
          <div className="staff-detail-grid">
            <p><small>Staff ID</small><strong>{profile.staffId || profile.id}</strong></p>
            <p><small>Clinic branch</small><strong>{profile.clinicBranch || "Amethyst Dental Clinic"}</strong></p>
          </div>
        </div>

        <form className="admin-form" onSubmit={saveProfile}>
          <div className="field-grid field-grid--two">
            <label className="field">
              <span>Full name · first</span>
              <input
                required
                value={form.firstName}
                onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>Full name · last</span>
              <input
                required
                value={form.lastName}
                onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>Email</span>
              <input
                required
                type="email"
                value={form.email}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>Contact number</span>
              <input
                required
                value={form.phone}
                onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>Position</span>
              <input value={profile.position || "Front Desk Coordinator"} disabled />
            </label>
            <label className="field">
              <span>Account status</span>
              <input value={profile.accountStatus || "active"} disabled />
            </label>
          </div>
          <div className="staff-heading-actions">
            <button className="button button--primary" disabled={Boolean(busy)}>
              <Save size={16} /> {busy === "save" ? "Saving…" : "Save Changes"}
            </button>
            <button type="button" className="button button--secondary" onClick={() => setPasswordOpen(true)}>
              <KeyRound size={16} /> Change Password
            </button>
          </div>
        </form>
      </section>

      {passwordOpen ? (
        <StaffModal title="Change password" onClose={() => setPasswordOpen(false)}>
          <form className="admin-form" onSubmit={changePassword}>
            <label className="field">
              <span>Current password</span>
              <input
                required
                type="password"
                value={passwordForm.currentPassword}
                onChange={(event) =>
                  setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>New password</span>
              <input
                required
                type="password"
                minLength={8}
                value={passwordForm.newPassword}
                onChange={(event) =>
                  setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Confirm new password</span>
              <input
                required
                type="password"
                minLength={8}
                value={passwordForm.confirmPassword}
                onChange={(event) =>
                  setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))
                }
              />
            </label>
            <button className="button button--primary" disabled={Boolean(busy)}>
              {busy === "password" ? "Updating…" : "Update password"}
            </button>
          </form>
        </StaffModal>
      ) : null}
    </div>
  );
}
