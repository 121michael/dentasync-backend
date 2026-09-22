import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  Phone,
  ShieldCheck,
  X,
} from "lucide-react";
import { ApiError, api } from "../api";
import { BrandMark } from "../components/BrandMark";
import { LegalDocument } from "../components/LegalDocument";
import { legalDocumentById } from "../legal/dentasyncLegal";
import { useAuth } from "../useAuth";

const PENDING_OTP_KEY = "amethyst_pending_otp";

function initialPendingOtp() {
  try {
    return JSON.parse(sessionStorage.getItem(PENDING_OTP_KEY) || "null");
  } catch {
    return null;
  }
}

export function AuthPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { startSession } = useAuth();
  const [mode, setMode] = useState(() => (location.pathname.includes("register") ? "register" : "login"));
  const [screen, setScreen] = useState(() => (initialPendingOtp() ? "otp" : "form"));
  const [pendingOtp, setPendingOtp] = useState(initialPendingOtp);
  const [showPassword, setShowPassword] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    password: "",
    otp: "",
    patientCategory: "regular",
    acceptedTerms: false,
    acceptedPrivacy: false,
  });
  const [legalPreview, setLegalPreview] = useState(null);

  function safeNextPath() {
    const next = String(searchParams.get("next") || "").trim();
    if (!next.startsWith("/") || next.startsWith("//")) return null;
    return next;
  }

  useEffect(() => {
    if (screen === "otp") {
      document.getElementById("otp-code")?.focus();
    }
  }, [screen]);

  useEffect(() => {
    if (location.pathname.includes("register") && mode !== "register") {
      setMode("register");
    }
  }, [location.pathname, mode]);

  function updateForm(event) {
    const { name, type, checked, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  function savePendingOtp(nextPendingOtp) {
    sessionStorage.setItem(PENDING_OTP_KEY, JSON.stringify(nextPendingOtp));
    setPendingOtp(nextPendingOtp);
  }

  async function submitLogin(event) {
    event.preventDefault();
    setMessage("");
    setIsBusy(true);
    try {
      const response = await api.login({
        identifier: form.email,
        password: form.password,
      });
      startSession(response.token, response.user);
      const role = String(response.user?.role || "").toLowerCase();
      const nextPath = safeNextPath();
      const redirectTo =
        role === "patient" && nextPath
          ? nextPath
          : response.redirectTo ||
            (role === "admin"
              ? "/admin/dashboard"
              : role === "staff"
                ? "/staff/dashboard"
                : role === "dentist"
                  ? "/dentist/dashboard"
                  : role === "patient"
                    ? "/dashboard"
                    : "/access-denied");
      navigate(redirectTo, { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.data?.requiresOtp) {
        savePendingOtp({
          email: error.data.email || form.email,
          phone: error.data.phone || form.phone,
          requestId: null,
        });
        setScreen("otp");
        setMessage("Your account still needs verification. Request a fresh code to continue.");
      } else if (error instanceof ApiError && error.data?.requiresAdminApproval) {
        setMessage(error.message);
      } else {
        setMessage(error.message);
      }
    } finally {
      setIsBusy(false);
    }
  }

  async function submitRegistration(event) {
    event.preventDefault();
    setMessage("");
    if (!form.acceptedTerms || !form.acceptedPrivacy) {
      setMessage(
        "Please read and agree to the Terms and Conditions and Privacy Notice before creating an account."
      );
      return;
    }
    setIsBusy(true);
    try {
      const response = await api.register({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phone: form.phone,
        password: form.password,
        role: "patient",
        patientCategory: form.patientCategory || "regular",
        acceptedTerms: true,
        acceptedPrivacy: true,
      });
      savePendingOtp({
        email: form.email,
        phone: form.phone,
        requestId: response.requestId || null,
      });
      setScreen("otp");
      setMessage("A six-digit verification code has been sent to your email.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setIsBusy(false);
    }
  }

  async function resendCode() {
    if (!pendingOtp?.email || !pendingOtp?.phone) {
      setMessage("Enter your email and mobile number first.");
      return;
    }

    setMessage("");
    setIsBusy(true);
    try {
      const response = await api.resendOtp({
        email: pendingOtp.email,
        phone: pendingOtp.phone,
      });
      savePendingOtp({ ...pendingOtp, requestId: response.requestId });
      setMessage("A new verification code is on its way.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setIsBusy(false);
    }
  }

  async function submitOtp(event) {
    event.preventDefault();
    setMessage("");
    setIsBusy(true);
    try {
      const response = await api.verifyOtp({
        requestId: pendingOtp?.requestId || undefined,
        phone: pendingOtp?.phone,
        otp: form.otp,
      });
      sessionStorage.removeItem(PENDING_OTP_KEY);
      if (response.requiresAdminApproval || !response.token) {
        setPendingOtp(null);
        setMessage(
          response.message ||
            "Email verified. Wait for administrator approval before signing in to book appointments."
        );
        navigate("/login");
        return;
      }
      startSession(response.token, response.user);
      navigate(response.redirectTo || "/dashboard");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setIsBusy(false);
    }
  }

  const isRegistration = mode === "register";

  return (
    <main className="auth-page">
      <div className="auth-page__glow auth-page__glow--one" />
      <div className="auth-page__glow auth-page__glow--two" />
      <section className="auth-showcase">
        <BrandMark />
        <div className="auth-showcase__copy">
          <span className="eyebrow">Private dental care, beautifully connected</span>
          <h1>More confidence in every care moment.</h1>
          <p>
            Schedule, track, and understand your dental journey through one calm,
            secure patient experience.
          </p>
        </div>
        <div className="auth-showcase__features">
          {[
            "Effortless appointment planning",
            "Secure treatment record access",
            "Real-time clinic queue updates",
          ].map((feature) => (
            <span key={feature}>
              <CheckCircle2 size={18} aria-hidden="true" /> {feature}
            </span>
          ))}
        </div>
      </section>

      <section className="auth-panel">
        {screen === "otp" ? (
          <form className="auth-card" onSubmit={submitOtp}>
            <button
              type="button"
              className="back-button"
              onClick={() => {
                setScreen("form");
                setMessage("");
              }}
            >
              <ArrowLeft size={17} /> Back
            </button>
            <span className="auth-card__icon">
              <Mail size={26} />
            </span>
            <span className="eyebrow">Confirm your email</span>
            <h2>Enter your verification code</h2>
            <p>
              We sent a six-digit code to <strong>{pendingOtp?.email || "your inbox"}</strong>.
            </p>
            <label className="field field--otp">
              <span>Verification code</span>
              <input
                id="otp-code"
                name="otp"
                value={form.otp}
                onChange={updateForm}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength="6"
                pattern="\d{6}"
                placeholder="000000"
                required
              />
            </label>
            {message && <p className="form-message">{message}</p>}
            <button className="button button--primary button--wide" disabled={isBusy}>
              {isBusy ? "Verifying safely…" : "Verify & enter your portal"} <ArrowRight size={18} />
            </button>
            <button type="button" className="text-link text-link--center" onClick={resendCode} disabled={isBusy}>
              Resend a new code
            </button>
          </form>
        ) : (
          <form className="auth-card" onSubmit={isRegistration ? submitRegistration : submitLogin}>
            <span className="auth-card__icon">
              <ShieldCheck size={26} />
            </span>
            <span className="eyebrow">{isRegistration ? "Begin your care journey" : "Welcome back"}</span>
            <h2>{isRegistration ? "Create your private portal" : "Sign in to Amethyst Dental"}</h2>
            <p>
              {isRegistration
                ? "Your account will be verified with a one-time code before access is granted."
                : "Access your authorized patient or clinic workspace securely."}
            </p>

            {isRegistration && (
              <div className="field-row">
                <label className="field">
                  <span>First name</span>
                  <input name="firstName" value={form.firstName} onChange={updateForm} required />
                </label>
                <label className="field">
                  <span>Last name</span>
                  <input name="lastName" value={form.lastName} onChange={updateForm} required />
                </label>
              </div>
            )}
            <label className="field">
              <span>Email address</span>
              <span className="field__input-icon">
                <Mail size={17} />
                <input
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={updateForm}
                  autoComplete="email"
                  required
                />
              </span>
            </label>
            {isRegistration && (
              <label className="field">
                <span>Mobile number</span>
                <span className="field__input-icon">
                  <Phone size={17} />
                  <input
                    name="phone"
                    value={form.phone}
                    onChange={updateForm}
                    placeholder="0917 123 4567"
                    autoComplete="tel"
                    required
                  />
                </span>
              </label>
            )}
            {isRegistration && (
              <label className="field">
                <span>Patient category</span>
                <select
                  name="patientCategory"
                  value={form.patientCategory}
                  onChange={updateForm}
                  required
                >
                  <option value="regular">Regular Patient (A)</option>
                  <option value="senior">Senior Citizen (S)</option>
                  <option value="pediatric">Pediatric Patient (P)</option>
                  <option value="pwd">Person with Disability / PWD (W)</option>
                </select>
              </label>
            )}
            <label className="field">
              <span>Password</span>
              <span className="field__input-icon">
                <LockKeyhole size={17} />
                <input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={updateForm}
                  autoComplete={isRegistration ? "new-password" : "current-password"}
                  minLength={isRegistration ? 10 : undefined}
                  required
                />
                <button
                  type="button"
                  className="field__visibility"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </span>
            </label>
            {!isRegistration && (
              <button
                type="button"
                className="text-link auth-card__forgot-link"
                onClick={() => navigate("/forgot-password")}
              >
                Forgot password?
              </button>
            )}
            {isRegistration ? (
              <fieldset className="auth-consent">
                <legend>Privacy &amp; Terms</legend>
                <label className="auth-consent__check">
                  <input
                    type="checkbox"
                    name="acceptedTerms"
                    checked={form.acceptedTerms}
                    onChange={updateForm}
                  />
                  <span>I have read and agree to the Terms and Conditions.</span>
                </label>
                <label className="auth-consent__check">
                  <input
                    type="checkbox"
                    name="acceptedPrivacy"
                    checked={form.acceptedPrivacy}
                    onChange={updateForm}
                  />
                  <span>
                    I acknowledge the DentaSync Privacy Notice and consent to the processing of my
                    personal and health information for the purposes described therein.
                  </span>
                </label>
                <div className="auth-consent__actions">
                  <button type="button" className="button button--secondary" onClick={() => setLegalPreview("terms")}>
                    Terms &amp; Conditions
                  </button>
                  <button type="button" className="button button--secondary" onClick={() => setLegalPreview("privacy")}>
                    Privacy Notice
                  </button>
                </div>
              </fieldset>
            ) : null}
            {message && <p className="form-message">{message}</p>}
            <button
              className="button button--primary button--wide"
              disabled={isBusy || (isRegistration && (!form.acceptedTerms || !form.acceptedPrivacy))}
            >
              {isBusy
                ? "Please wait…"
                : isRegistration
                  ? "Create account"
                  : "Enter your portal"}{" "}
              <ArrowRight size={18} />
            </button>
            <div className="auth-tabs" role="tablist" aria-label="Portal access">
              <button
                type="button"
                className={mode === "login" ? "is-active" : ""}
                onClick={() => {
                  setMode("login");
                  setMessage("");
                  navigate("/login");
                }}
              >
                Sign in
              </button>
              <button
                type="button"
                className={mode === "register" ? "is-active" : ""}
                onClick={() => {
                  setMode("register");
                  setMessage("");
                  navigate("/register");
                }}
              >
                Create account
              </button>
            </div>
          </form>
        )}
        <p className="auth-security-note">
          <LockKeyhole size={15} /> Your health information is protected with account-level access controls.
        </p>
        <p className="auth-legal-links">
          <Link to="/terms">Terms &amp; Conditions</Link>
          <span aria-hidden="true"> · </span>
          <Link to="/privacy">Privacy Notice</Link>
        </p>
      </section>
      {legalPreview ? (
        <div
          className="legal-modal-backdrop"
          role="presentation"
          onMouseDown={() => setLegalPreview(null)}
        >
          <section
            className="legal-modal"
            role="dialog"
            aria-modal="true"
            aria-label={legalPreview === "privacy" ? "Privacy Notice" : "Terms and Conditions"}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="legal-modal__header">
              <strong>{legalPreview === "privacy" ? "Privacy Notice" : "Terms & Conditions"}</strong>
              <button
                type="button"
                className="icon-button"
                aria-label="Close"
                onClick={() => setLegalPreview(null)}
              >
                <X size={18} />
              </button>
            </header>
            <div className="legal-modal__body">
              <LegalDocument document={legalDocumentById(legalPreview)} />
            </div>
            <div className="legal-modal__actions">
              <button type="button" className="button button--primary" onClick={() => setLegalPreview(null)}>
                Close
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
