import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
} from "lucide-react";
import { ApiError, api } from "../api";
import { BrandMark } from "../components/BrandMark";
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
  const { startSession } = useAuth();
  const [mode, setMode] = useState("login");
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
  });

  useEffect(() => {
    if (screen === "otp") {
      document.getElementById("otp-code")?.focus();
    }
  }, [screen]);

  function updateForm(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
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
      navigate("/dashboard");
    } catch (error) {
      if (error instanceof ApiError && error.data?.requiresOtp) {
        savePendingOtp({
          email: error.data.email || form.email,
          phone: error.data.phone || form.phone,
          requestId: null,
        });
        setScreen("otp");
        setMessage("Your account still needs verification. Request a fresh code to continue.");
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
    setIsBusy(true);
    try {
      const response = await api.register({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phone: form.phone,
        password: form.password,
        role: "patient",
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
            <div className="auth-tabs" role="tablist" aria-label="Portal access">
              <button
                type="button"
                className={mode === "login" ? "is-active" : ""}
                onClick={() => {
                  setMode("login");
                  setMessage("");
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
                }}
              >
                Create account
              </button>
            </div>
            <span className="auth-card__icon">
              <ShieldCheck size={26} />
            </span>
            <span className="eyebrow">{isRegistration ? "Begin your care journey" : "Welcome back"}</span>
            <h2>{isRegistration ? "Create your private portal" : "Sign in to your care portal"}</h2>
            <p>
              {isRegistration
                ? "Your account will be verified with a one-time code before access is granted."
                : "Your care plan, appointments, and records are waiting."}
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
            {message && <p className="form-message">{message}</p>}
            <button className="button button--primary button--wide" disabled={isBusy}>
              {isBusy
                ? "Please wait…"
                : isRegistration
                  ? "Create secure account"
                  : "Enter your portal"}{" "}
              <ArrowRight size={18} />
            </button>
          </form>
        )}
        <p className="auth-security-note">
          <LockKeyhole size={15} /> Your health information is protected with account-level access controls.
        </p>
      </section>
    </main>
  );
}
