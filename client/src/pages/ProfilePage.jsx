import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  CalendarDays,
  Check,
  CreditCard,
  KeyRound,
  LockKeyhole,
  Save,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { api } from "../api";
import { ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { useAuth } from "../useAuth";

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
    new Date(value)
  );
}

function initials(firstName, lastName) {
  return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase() || "AD";
}

function Toggle({ checked, onChange, label, detail, disabled = false }) {
  return (
    <label className={`settings-toggle ${disabled ? "is-disabled" : ""}`}>
      <span>
        <strong>{label}</strong>
        {detail && <small>{detail}</small>}
      </span>
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
      <i aria-hidden="true" />
    </label>
  );
}

function profileToForm(profile) {
  return {
    firstName: profile.firstName || "",
    lastName: profile.lastName || "",
    email: profile.email || "",
    phone: profile.phone || "",
    dateOfBirth: profile.date_of_birth || "",
    gender: profile.gender || "",
    address: profile.address || "",
    emergencyContactName: profile.emergency_contact_name || "",
    emergencyContactRelationship: profile.emergency_contact_relationship || "",
    emergencyContactPhone: profile.emergency_contact_phone || "",
    allergies: profile.allergies || "",
    existingConditions: profile.existing_conditions || "",
    currentMedications: profile.current_medications || "",
    dentalConcerns: profile.dental_concerns || "",
    hmoProvider: profile.hmo_provider || "",
    hmoMemberNumber: profile.hmo_member_number || "",
  };
}

export function ProfilePage({ theme, onThemeChange }) {
  const { updateUser } = useAuth();
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState(null);
  const [preferences, setPreferences] = useState({ theme: "light", notifyQueue: false, twoFactorEnabled: false });
  const [security, setSecurity] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "" });

  const load = useCallback(async () => {
    setError("");
    try {
      const [profileResponse, securityResponse] = await Promise.all([
        api.getProfile(),
        api.getSecurity(),
      ]);
      setProfile(profileResponse.profile);
      setForm(profileToForm(profileResponse.profile));
      setPreferences(profileResponse.preferences);
      setSecurity(securityResponse);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const qrCells = useMemo(
    () => Array.from({ length: 49 }, (_, index) => [0, 1, 2, 6, 7, 8, 42, 43, 44, 48].includes(index) || (index * 13 + 5) % 5 < 2),
    []
  );

  function updateForm(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function saveProfile(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setIsSaving(true);
    try {
      const response = await api.updateProfile(form);
      setProfile((current) => ({ ...current, ...response.profile, firstName: form.firstName, lastName: form.lastName, email: form.email, phone: form.phone }));
      updateUser((current) => ({
        ...current,
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phone: form.phone,
      }));
      setSuccess("Your personal information has been saved.");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function updatePreferences(nextPreferences) {
    setError("");
    try {
      const response = await api.updatePreferences(nextPreferences);
      setPreferences(response.preferences);
      if (response.preferences.theme !== theme) {
        onThemeChange(response.preferences.theme);
      }
    } catch (preferenceError) {
      setError(preferenceError.message);
    }
  }

  async function savePassword(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    try {
      const response = await api.updatePassword(passwords);
      setPasswords({ currentPassword: "", newPassword: "" });
      setSuccess(response.message);
    } catch (passwordError) {
      setError(passwordError.message);
    }
  }

  if (error && !form) return <ErrorState message={error} onRetry={load} />;
  if (!form || !profile || !security) return <LoadingState label="Preparing your private membership profile" />;

  return (
    <div className="profile-page">
      <SectionHeading
        eyebrow="Your private membership"
        title="My profile"
        detail="Keep your care preferences and clinical details ready for every visit."
      />
      {error && <p className="inline-alert inline-alert--error">{error}</p>}
      {success && <p className="inline-alert inline-alert--success"><Check size={17} /> {success}</p>}

      <section className="membership-card">
        <div className="membership-card__shine" />
        <div className="membership-card__top">
          <span className="membership-card__logo"><CreditCard size={21} /> Amethyst Dental</span>
          <span>PREMIUM PATIENT</span>
        </div>
        <div className="membership-card__identity">
          <span className="membership-card__avatar">{initials(form.firstName, form.lastName)}</span>
          <div>
            <strong>{`${form.firstName} ${form.lastName}`.trim() || "Amethyst patient"}</strong>
            <small>Patient ID · {profile.id || "Secure portal account"}</small>
          </div>
        </div>
        <div className="membership-card__bottom">
          <div>
            <span>Membership tier</span>
            <strong>{profile.membership_tier || "Premium Patient"}</strong>
          </div>
          <div>
            <span>Member since</span>
            <strong>{formatDate(profile.memberSince)}</strong>
          </div>
          <div className="membership-card__verified">
            <BadgeCheck size={17} /> {profile.verified ? "Verified" : "Verification pending"}
          </div>
          <div className="qr-grid" aria-label="Membership QR code">
            {qrCells.map((filled, index) => <i key={index} className={filled ? "is-filled" : ""} />)}
          </div>
        </div>
      </section>

      <div className="profile-layout">
        <form id="profile-form" onSubmit={saveProfile} className="profile-form-stack">
          <section className="glass-card profile-section">
            <div className="card-heading">
              <div>
                <span className="eyebrow">About you</span>
                <h2>Personal information</h2>
              </div>
              <UserRound className="card-heading__icon" size={21} />
            </div>
            <div className="field-grid field-grid--two">
              <label className="field"><span>First name</span><input name="firstName" value={form.firstName} onChange={updateForm} required /></label>
              <label className="field"><span>Last name</span><input name="lastName" value={form.lastName} onChange={updateForm} required /></label>
              <label className="field"><span>Email address</span><input name="email" type="email" value={form.email} onChange={updateForm} required /></label>
              <label className="field"><span>Mobile number</span><input name="phone" value={form.phone} onChange={updateForm} required /></label>
              <label className="field"><span>Date of birth</span><input name="dateOfBirth" type="date" value={form.dateOfBirth} onChange={updateForm} /></label>
              <label className="field"><span>Gender</span><select name="gender" value={form.gender} onChange={updateForm}><option value="">Prefer not to say</option><option>Female</option><option>Male</option><option>Non-binary</option><option>Prefer to self-describe</option></select></label>
              <label className="field field--full"><span>Address</span><input name="address" value={form.address} onChange={updateForm} /></label>
            </div>
          </section>

          <section className="glass-card profile-section">
            <div className="card-heading">
              <div>
                <span className="eyebrow">For peace of mind</span>
                <h2>Emergency contact</h2>
              </div>
              <ShieldCheck className="card-heading__icon" size={21} />
            </div>
            <div className="field-grid field-grid--three">
              <label className="field"><span>Contact name</span><input name="emergencyContactName" value={form.emergencyContactName} onChange={updateForm} /></label>
              <label className="field"><span>Relationship</span><input name="emergencyContactRelationship" value={form.emergencyContactRelationship} onChange={updateForm} /></label>
              <label className="field"><span>Mobile number</span><input name="emergencyContactPhone" value={form.emergencyContactPhone} onChange={updateForm} /></label>
            </div>
          </section>

          <section className="glass-card profile-section">
            <div className="card-heading">
              <div>
                <span className="eyebrow">Shared securely with your care team</span>
                <h2>Clinical information</h2>
              </div>
              <CalendarDays className="card-heading__icon" size={21} />
            </div>
            <div className="field-grid field-grid--two">
              <label className="field field--warning">
                <span><AlertTriangle size={14} /> Allergies</span>
                <textarea name="allergies" rows="3" value={form.allergies} onChange={updateForm} placeholder="List known allergies or write none." />
              </label>
              <label className="field"><span>Existing conditions</span><textarea name="existingConditions" rows="3" value={form.existingConditions} onChange={updateForm} /></label>
              <label className="field"><span>Current medications</span><textarea name="currentMedications" rows="3" value={form.currentMedications} onChange={updateForm} /></label>
              <label className="field"><span>Dental concerns</span><textarea name="dentalConcerns" rows="3" value={form.dentalConcerns} onChange={updateForm} /></label>
            </div>
          </section>

          <section className="glass-card profile-section">
            <div className="card-heading">
              <div>
                <span className="eyebrow">Coverage & wellness</span>
                <h2>Care preferences</h2>
              </div>
            </div>
            <div className="field-grid field-grid--two">
              <label className="field"><span>HMO provider</span><input name="hmoProvider" value={form.hmoProvider} onChange={updateForm} /></label>
              <label className="field"><span>HMO member number</span><input name="hmoMemberNumber" value={form.hmoMemberNumber} onChange={updateForm} /></label>
            </div>
            <div className="care-summary">
              <span><small>Oral health score</small><strong>{profile.oral_health_score ?? "Awaiting clinician assessment"}</strong></span>
              <span><small>Last cleaning</small><strong>{profile.last_cleaning ? formatDate(profile.last_cleaning) : "Not recorded"}</strong></span>
              <span><small>Next checkup</small><strong>{profile.next_checkup ? formatDate(profile.next_checkup) : "To be recommended"}</strong></span>
            </div>
          </section>
        </form>

        <aside className="profile-security-stack">
          <section className="glass-card security-card">
            <div className="card-heading">
              <div>
                <span className="eyebrow">Security</span>
                <h2>Account protection</h2>
              </div>
              <LockKeyhole className="card-heading__icon" size={21} />
            </div>
            <div className="verification-status">
              <BadgeCheck size={21} />
              <div><strong>{security.verified ? "Account verified" : "Verification required"}</strong><small>Protected patient account access</small></div>
            </div>
            <Toggle
              checked={preferences.notifyQueue}
              onChange={(event) => updatePreferences({ ...preferences, notifyQueue: event.target.checked })}
              label="Queue notifications"
              detail="Receive a reminder as your turn gets closer."
            />
            <Toggle
              checked={preferences.twoFactorEnabled}
              onChange={(event) => updatePreferences({ ...preferences, twoFactorEnabled: event.target.checked })}
              label="Two-factor preference"
              detail="Save your preference for the next clinic-approved security setup."
            />
            <Toggle
              checked={theme === "dark"}
              onChange={(event) => updatePreferences({ ...preferences, theme: event.target.checked ? "dark" : "light" })}
              label={theme === "dark" ? "Dark portal appearance" : "Light portal appearance"}
              detail="Choose the theme that feels most comfortable."
            />
          </section>

          <section className="glass-card password-card">
            <div className="card-heading">
              <div>
                <span className="eyebrow">Password management</span>
                <h2>Update password</h2>
              </div>
              <KeyRound className="card-heading__icon" size={21} />
            </div>
            <form onSubmit={savePassword} className="compact-form">
              <label className="field"><span>Current password</span><input type="password" value={passwords.currentPassword} onChange={(event) => setPasswords((current) => ({ ...current, currentPassword: event.target.value }))} required /></label>
              <label className="field"><span>New password</span><input type="password" minLength="10" value={passwords.newPassword} onChange={(event) => setPasswords((current) => ({ ...current, newPassword: event.target.value }))} required /></label>
              <button className="button button--secondary button--wide">Update password</button>
            </form>
          </section>

          <section className="glass-card activity-card">
            <div className="card-heading">
              <div>
                <span className="eyebrow">Recent account activity</span>
                <h2>Login activity</h2>
              </div>
            </div>
            {security.activity.length ? (
              <div className="activity-list">
                {security.activity.map((activity, index) => (
                  <div key={`${activity.created_at}-${index}`}>
                    <span>{activity.event_type.replaceAll("_", " ")}</span>
                    <small>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(activity.created_at))}</small>
                  </div>
                ))}
              </div>
            ) : <p className="muted-copy">Your authenticated portal activity will appear here.</p>}
          </section>
        </aside>

        <button form="profile-form" className="button button--primary profile-save-button" disabled={isSaving}>
          <Save size={18} /> {isSaving ? "Saving changes…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
