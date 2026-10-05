import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { api } from "../api";
import { BrandMark } from "../components/BrandMark";

function AuthShowcase() {
  return (
    <section className="auth-showcase">
      <BrandMark />
      <div className="auth-showcase__copy">
        <span className="eyebrow">Private dental care, beautifully connected</span>
        <h1>Your care account stays in your hands.</h1>
        <p>
          Reset access securely, then return to your appointments, care plan, and
          private treatment records.
        </p>
      </div>
      <div className="auth-showcase__features">
        {[
          "One-time, time-limited reset links",
          "Private account protection",
          "Secure return to your care portal",
        ].map((feature) => (
          <span key={feature}>
            <CheckCircle2 size={18} aria-hidden="true" /> {feature}
          </span>
        ))}
      </div>
    </section>
  );
}

function PasswordField({ id, label, value, onChange, showPassword, onToggle, autoComplete }) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="field__input-icon">
        <LockKeyhole size={17} />
        <input
          id={id}
          type={showPassword ? "text" : "password"}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          minLength="10"
          required
        />
        <button
          type="button"
          className="field__visibility"
          onClick={onToggle}
          aria-label={showPassword ? "Hide password" : "Show password"}
        >
          {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </span>
    </label>
  );
}

export function PasswordResetPage({ mode }) {
  const navigate = useNavigate();
  const { token: pathToken } = useParams();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [complete, setComplete] = useState(false);
  const token = pathToken || searchParams.get("token") || "";
  const isRequest = mode === "request";

  async function submitRequest(event) {
    event.preventDefault();
    setMessage("");
    setIsBusy(true);
    try {
      const response = await api.requestPasswordReset({ email });
      setMessage(response.message);
      setComplete(true);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setIsBusy(false);
    }
  }

  async function submitReset(event) {
    event.preventDefault();
    setMessage("");
    if (newPassword !== confirmPassword) {
      setMessage("The new passwords do not match.");
      return;
    }

    setIsBusy(true);
    try {
      const response = await api.resetPassword({ token, newPassword });
      setMessage(response.message);
      setComplete(true);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-page__glow auth-page__glow--one" />
      <div className="auth-page__glow auth-page__glow--two" />
      <AuthShowcase />
      <section className="auth-panel">
        {isRequest ? (
          <form className="auth-card" onSubmit={submitRequest}>
            <button type="button" className="back-button" onClick={() => navigate("/login")}>
              <ArrowLeft size={17} /> Back to sign in
            </button>
            <span className="auth-card__icon">
              <KeyRound size={26} />
            </span>
            <span className="eyebrow">Restore account access</span>
            <h2>Forgot your password?</h2>
            <p>
              Enter your email address and we’ll send a secure, one-time reset link
              if it matches a verified Amethyst Dental account.
            </p>
            {!complete && (
              <label className="field">
                <span>Email address</span>
                <span className="field__input-icon">
                  <Mail size={17} />
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    required
                  />
                </span>
              </label>
            )}
            {message && <p className={`form-message ${complete ? "form-message--success" : ""}`}>{message}</p>}
            {complete ? (
              <button type="button" className="button button--primary button--wide" onClick={() => navigate("/login")}>
                Return to sign in <ArrowRight size={18} />
              </button>
            ) : (
              <button className="button button--primary button--wide" disabled={isBusy}>
                {isBusy ? "Sending secure link…" : "Send reset link"} <ArrowRight size={18} />
              </button>
            )}
          </form>
        ) : (
          <form className="auth-card" onSubmit={submitReset}>
            <button type="button" className="back-button" onClick={() => navigate("/login")}>
              <ArrowLeft size={17} /> Back to sign in
            </button>
            <span className="auth-card__icon">
              <ShieldCheck size={26} />
            </span>
            <span className="eyebrow">Secure password reset</span>
            <h2>Create a new password</h2>
            <p>
              Choose a strong password with at least 10 characters. This reset link
              can be used only once.
            </p>
            {!token ? (
              <>
                <p className="form-message">This reset link is incomplete. Request a new link to continue.</p>
                <button type="button" className="button button--primary button--wide" onClick={() => navigate("/forgot-password")}>
                  Request a new link <ArrowRight size={18} />
                </button>
              </>
            ) : complete ? (
              <>
                {message && <p className="form-message form-message--success">{message}</p>}
                <button type="button" className="button button--primary button--wide" onClick={() => navigate("/login")}>
                  Sign in securely <ArrowRight size={18} />
                </button>
              </>
            ) : (
              <>
                <PasswordField
                  id="new-password"
                  label="New password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  showPassword={showPassword}
                  onToggle={() => setShowPassword((current) => !current)}
                  autoComplete="new-password"
                />
                <PasswordField
                  id="confirm-password"
                  label="Confirm new password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  showPassword={showPassword}
                  onToggle={() => setShowPassword((current) => !current)}
                  autoComplete="new-password"
                />
                {message && <p className="form-message">{message}</p>}
                <button className="button button--primary button--wide" disabled={isBusy}>
                  {isBusy ? "Updating password…" : "Save new password"} <ArrowRight size={18} />
                </button>
              </>
            )}
          </form>
        )}
        <p className="auth-security-note">
          <LockKeyhole size={15} /> Reset links are private, one-time, and expire automatically.
        </p>
      </section>
    </main>
  );
}
