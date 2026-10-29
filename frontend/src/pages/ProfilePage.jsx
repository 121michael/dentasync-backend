import { useCallback, useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  HeartPulse,
  KeyRound,
  LockKeyhole,
  Save,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { api } from "../api";
import { ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { useAuth } from "../useAuth";

const PROFILE_MENU = [
  {
    id: "personal",
    title: "Personal Information",
    description: "View and update your personal details",
    icon: UserRound,
  },
  {
    id: "emergency",
    title: "Emergency Contact",
    description: "Manage your emergency contact details",
    icon: ShieldCheck,
  },
  {
    id: "clinical",
    title: "Clinical Information",
    description: "Review your dental and clinical information",
    icon: HeartPulse,
  },
  {
    id: "coverage",
    title: "Coverage and Wellness",
    description: "View your coverage and wellness information",
    icon: CalendarDays,
  },
  {
    id: "security",
    title: "Account Security",
    description: "Review security settings for your account",
    icon: LockKeyhole,
  },
  {
    id: "password",
    title: "Password Management",
    description: "Change or update your password",
    icon: KeyRound,
  },
  {
    id: "activity",
    title: "Account Activity",
    description: "Review available account activity and login history",
    icon: Activity,
  },
];

const PROFILE_FORM_SECTIONS = new Set(["personal", "emergency", "clinical", "coverage"]);

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
    patientCategory: profile.patientCategory || profile.patient_category || "regular",
  };
}

export function ProfilePage() {
  const { theme = "light", onThemeChange } = useOutletContext() || {};
  const { updateUser } = useAuth();
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState(null);
  const [preferences, setPreferences] = useState({
    theme: "light",
    notifyQueue: false,
    notifySms: true,
    notifyAppointmentSms: true,
    notifyQueueSms: true,
    notifyCleaningSms: true,
    twoFactorEnabled: false,
  });
  const [security, setSecurity] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "" });
  const [activeSection, setActiveSection] = useState(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const [profileResponse, securityResponse] = await Promise.all([
        api.getProfile(),
        api.getSecurity(),
      ]);
      setProfile(profileResponse.profile);
      setForm(profileToForm(profileResponse.profile));
      setPreferences({ ...profileResponse.preferences, theme: themeRef.current || "light" });
      setSecurity(securityResponse);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function updateForm(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  function isSectionDirty() {
    if (!form || !profile) return false;
    if (PROFILE_FORM_SECTIONS.has(activeSection)) {
      const original = profileToForm(profile);
      return Object.keys(original).some((key) => String(form[key] ?? "") !== String(original[key] ?? ""));
    }
    if (activeSection === "password") {
      return Boolean(passwords.currentPassword || passwords.newPassword);
    }
    return false;
  }

  function openSection(sectionId) {
    setError("");
    setSuccess("");
    setActiveSection(sectionId);
  }

  function goBackToMenu() {
    if (isSectionDirty()) {
      const leave = window.confirm("You have unsaved changes. Leave this section without saving?");
      if (!leave) return;
      setForm(profileToForm(profile));
      setPasswords({ currentPassword: "", newPassword: "" });
    }
    setError("");
    setSuccess("");
    setActiveSection(null);
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
      setPreferences({ ...response.preferences, theme: nextPreferences.theme || theme });
      if (nextPreferences.theme && nextPreferences.theme !== theme && typeof onThemeChange === "function") {
        onThemeChange(nextPreferences.theme);
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

  const currentMenu = PROFILE_MENU.find((item) => item.id === activeSection);

  return (
    <div className="profile-page">
      <SectionHeading
        eyebrow="Your private membership"
        title="My Profile"
        detail={
          currentMenu
            ? currentMenu.description
            : "Choose a category to view or update your profile."
        }
      />
      {error && <p className="inline-alert inline-alert--error">{error}</p>}
      {success && (
        <p className="inline-alert inline-alert--success">
          <Check size={17} /> {success}
        </p>
      )}

      {!activeSection ? (
        <>
          <section className="membership-card">
            <div className="membership-card__shine" />
            <div className="membership-card__top">
              <span className="membership-card__logo">
                <img src="/logo.png" alt="" className="membership-card__logo-image" />
                Amethyst Dental
              </span>
              <span>PREMIUM PATIENT</span>
            </div>
            <div className="membership-card__identity">
              <span className="membership-card__avatar">{initials(form.firstName, form.lastName)}</span>
              <div>
                <strong>{`${form.firstName} ${form.lastName}`.trim() || "Amethyst patient"}</strong>
                <small>
                  Patient ID · {profile.patientId || profile.id || "Issued at registration"}
                </small>
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
            </div>
          </section>

          <nav className="profile-menu" aria-label="My Profile categories">
            {PROFILE_MENU.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="profile-menu__item"
                  onClick={() => openSection(item.id)}
                >
                  <span className="profile-menu__icon" aria-hidden="true">
                    <Icon size={18} />
                  </span>
                  <span className="profile-menu__copy">
                    <strong>{item.title}</strong>
                    <small>{item.description}</small>
                  </span>
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              );
            })}
          </nav>
        </>
      ) : (
        <div className={`profile-layout profile-layout--section profile-layout--${activeSection}`}>
          <button type="button" className="button button--secondary profile-back" onClick={goBackToMenu}>
            <ChevronLeft size={16} /> Back to My Profile
          </button>

          {PROFILE_FORM_SECTIONS.has(activeSection) ? (
            <form id="profile-form" onSubmit={saveProfile} className="profile-form-stack">
              {activeSection === "personal" ? (
                <section className="glass-card profile-section">
                  <div className="card-heading">
                    <div>
                      <span className="eyebrow">About you</span>
                      <h2>Personal Information</h2>
                    </div>
                    <UserRound className="card-heading__icon" size={21} />
                  </div>
                  <div className="field-grid field-grid--two">
                    <label className="field">
                      <span>First name</span>
                      <input name="firstName" value={form.firstName} onChange={updateForm} required />
                    </label>
                    <label className="field">
                      <span>Last name</span>
                      <input name="lastName" value={form.lastName} onChange={updateForm} required />
                    </label>
                    <label className="field">
                      <span>Email address</span>
                      <input name="email" type="email" value={form.email} onChange={updateForm} required />
                    </label>
                    <label className="field">
                      <span>Mobile number</span>
                      <input name="phone" value={form.phone} onChange={updateForm} required />
                    </label>
                    <label className="field">
                      <span>Date of birth</span>
                      <input name="dateOfBirth" type="date" value={form.dateOfBirth} onChange={updateForm} />
                    </label>
                    <label className="field">
                      <span>Gender</span>
                      <select name="gender" value={form.gender} onChange={updateForm}>
                        <option value="">Prefer not to say</option>
                        <option>Female</option>
                        <option>Male</option>
                        <option>Non-binary</option>
                        <option>Prefer to self-describe</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Patient category</span>
                      <select name="patientCategory" value={form.patientCategory} onChange={updateForm}>
                        <option value="regular">Regular Patient</option>
                        <option value="senior">Senior Citizen</option>
                        <option value="pediatric">Pediatric Patient</option>
                        <option value="pwd">PWD</option>
                      </select>
                    </label>
                    <label className="field field--full">
                      <span>Address</span>
                      <input name="address" value={form.address} onChange={updateForm} />
                    </label>
                  </div>
                </section>
              ) : null}

              {activeSection === "emergency" ? (
                <section className="glass-card profile-section">
                  <div className="card-heading">
                    <div>
                      <span className="eyebrow">For peace of mind</span>
                      <h2>Emergency Contact</h2>
                    </div>
                    <ShieldCheck className="card-heading__icon" size={21} />
                  </div>
                  <div className="field-grid field-grid--three">
                    <label className="field">
                      <span>Contact name</span>
                      <input name="emergencyContactName" value={form.emergencyContactName} onChange={updateForm} />
                    </label>
                    <label className="field">
                      <span>Relationship</span>
                      <input
                        name="emergencyContactRelationship"
                        value={form.emergencyContactRelationship}
                        onChange={updateForm}
                      />
                    </label>
                    <label className="field">
                      <span>Mobile number</span>
                      <input name="emergencyContactPhone" value={form.emergencyContactPhone} onChange={updateForm} />
                    </label>
                  </div>
                </section>
              ) : null}

              {activeSection === "clinical" ? (
                <section className="glass-card profile-section">
                  <div className="card-heading">
                    <div>
                      <span className="eyebrow">Shared securely with your care team</span>
                      <h2>Clinical Information</h2>
                    </div>
                    <CalendarDays className="card-heading__icon" size={21} />
                  </div>
                  <div className="field-grid field-grid--two">
                    <label className="field field--warning">
                      <span>
                        <AlertTriangle size={14} /> Allergies
                      </span>
                      <textarea
                        name="allergies"
                        rows="3"
                        value={form.allergies}
                        onChange={updateForm}
                        placeholder="List known allergies or write none."
                      />
                    </label>
                    <label className="field">
                      <span>Existing conditions</span>
                      <textarea
                        name="existingConditions"
                        rows="3"
                        value={form.existingConditions}
                        onChange={updateForm}
                      />
                    </label>
                    <label className="field">
                      <span>Current medications</span>
                      <textarea
                        name="currentMedications"
                        rows="3"
                        value={form.currentMedications}
                        onChange={updateForm}
                      />
                    </label>
                    <label className="field">
                      <span>Dental concerns</span>
                      <textarea
                        name="dentalConcerns"
                        rows="3"
                        value={form.dentalConcerns}
                        onChange={updateForm}
                      />
                    </label>
                  </div>
                </section>
              ) : null}

              {activeSection === "coverage" ? (
                <section className="glass-card profile-section">
                  <div className="card-heading">
                    <div>
                      <span className="eyebrow">Coverage and Wellness</span>
                      <h2>Care preferences</h2>
                    </div>
                  </div>
                  <div className="field-grid field-grid--two">
                    <label className="field">
                      <span>HMO provider</span>
                      <input name="hmoProvider" value={form.hmoProvider} onChange={updateForm} />
                    </label>
                    <label className="field">
                      <span>HMO member number</span>
                      <input name="hmoMemberNumber" value={form.hmoMemberNumber} onChange={updateForm} />
                    </label>
                  </div>
                  <div className="care-summary">
                    <span>
                      <small>Oral health score</small>
                      <strong>{profile.oral_health_score ?? "Awaiting clinician assessment"}</strong>
                    </span>
                    <span>
                      <small>Last cleaning</small>
                      <strong>{profile.last_cleaning ? formatDate(profile.last_cleaning) : "Not recorded"}</strong>
                    </span>
                    <span>
                      <small>Next checkup</small>
                      <strong>{profile.next_checkup ? formatDate(profile.next_checkup) : "To be recommended"}</strong>
                    </span>
                  </div>
                </section>
              ) : null}

              <button className="button button--primary profile-save-button" disabled={isSaving}>
                <Save size={18} /> {isSaving ? "Saving changes…" : "Save changes"}
              </button>
            </form>
          ) : null}

          {activeSection === "security" ? (
            <section className="glass-card security-card">
              <div className="card-heading">
                <div>
                  <span className="eyebrow">Security</span>
                  <h2>Account Security</h2>
                </div>
                <LockKeyhole className="card-heading__icon" size={21} />
              </div>
              <div className="verification-status">
                <BadgeCheck size={21} />
                <div>
                  <strong>{security.verified ? "Account verified" : "Verification required"}</strong>
                  <small>Protected patient account access</small>
                </div>
              </div>
              <Toggle
                checked={preferences.notifyQueue}
                onChange={(event) => updatePreferences({ ...preferences, notifyQueue: event.target.checked })}
                label="Queue notifications"
                detail="Receive a reminder as your turn gets closer."
              />
              <Toggle
                checked={preferences.notifySms !== false}
                onChange={(event) => updatePreferences({ ...preferences, notifySms: event.target.checked })}
                label="SMS notifications"
                detail="Allow Amethyst to text your phone for clinic updates."
              />
              <Toggle
                checked={preferences.notifyAppointmentSms !== false}
                onChange={(event) =>
                  updatePreferences({ ...preferences, notifyAppointmentSms: event.target.checked })
                }
                label="Appointment SMS"
                detail="Get texts when appointments are confirmed, rescheduled, or cancelled."
              />
              <Toggle
                checked={preferences.notifyQueueSms !== false}
                onChange={(event) => updatePreferences({ ...preferences, notifyQueueSms: event.target.checked })}
                label="Queue SMS"
                detail="Get texts for check-in and queue position updates."
              />
              <Toggle
                checked={preferences.notifyCleaningSms !== false}
                onChange={(event) =>
                  updatePreferences({ ...preferences, notifyCleaningSms: event.target.checked })
                }
                label="Cleaning reminder SMS"
                detail="Get a reminder about every 4–6 months to book a cleaning."
              />
              <Toggle
                checked={preferences.twoFactorEnabled}
                onChange={(event) => updatePreferences({ ...preferences, twoFactorEnabled: event.target.checked })}
                label="Two-factor preference"
                detail="Save your preference for the next clinic-approved security setup."
              />
              <Toggle
                checked={theme === "dark"}
                onChange={(event) =>
                  updatePreferences({ ...preferences, theme: event.target.checked ? "dark" : "light" })
                }
                label={theme === "dark" ? "Dark portal appearance" : "Light portal appearance"}
                detail="Choose the theme that feels most comfortable."
              />
            </section>
          ) : null}

          {activeSection === "password" ? (
            <section className="glass-card password-card">
              <div className="card-heading">
                <div>
                  <span className="eyebrow">Password Management</span>
                  <h2>Update password</h2>
                </div>
                <KeyRound className="card-heading__icon" size={21} />
              </div>
              <form onSubmit={savePassword} className="compact-form">
                <label className="field">
                  <span>Current password</span>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={passwords.currentPassword}
                    onChange={(event) =>
                      setPasswords((current) => ({ ...current, currentPassword: event.target.value }))
                    }
                    required
                  />
                </label>
                <label className="field">
                  <span>New password</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength="10"
                    value={passwords.newPassword}
                    onChange={(event) =>
                      setPasswords((current) => ({ ...current, newPassword: event.target.value }))
                    }
                    required
                  />
                </label>
                <button className="button button--secondary button--wide">Update password</button>
              </form>
            </section>
          ) : null}

          {activeSection === "activity" ? (
            <section className="glass-card activity-card">
              <div className="card-heading">
                <div>
                  <span className="eyebrow">Account Activity</span>
                  <h2>Login activity</h2>
                </div>
              </div>
              {security.activity?.length ? (
                <div className="activity-list">
                  {security.activity.map((activity, index) => (
                    <div key={`${activity.created_at}-${index}`}>
                      <span>{String(activity.event_type || "activity").replaceAll("_", " ")}</span>
                      <small>
                        {activity.created_at
                          ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(
                              new Date(activity.created_at)
                            )
                          : "Date unavailable"}
                      </small>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted-copy">Your authenticated portal activity will appear here.</p>
              )}
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
