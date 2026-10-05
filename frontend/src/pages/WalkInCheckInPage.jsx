import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, QrCode } from "lucide-react";
import { api } from "../api";
import { BrandMark } from "../components/BrandMark";
import { LoadingState } from "../components/UI";
import { useAuth } from "../useAuth";
import { displayQueueStatus } from "../utils/walkInQr";

export function WalkInCheckInPage() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = useMemo(() => String(searchParams.get("token") || "").trim(), [searchParams]);
  const [sessionStatus, setSessionStatus] = useState(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setError("This check-in link is missing a secure token. Ask staff to show a new QR code.");
      return undefined;
    }

    (async () => {
      try {
        const response = await api.validateWalkInQr(token);
        if (!cancelled) {
          setSessionStatus(response);
          setError("");
        }
      } catch (validateError) {
        if (!cancelled) {
          setSessionStatus(null);
          setError(validateError.message || "This QR code is not valid.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (isLoading || !token || !user) return;
    if (String(user.role || "").toLowerCase() !== "patient") return;
    if (result || busy) return;
    // Auto-redeem once a patient is signed in against a valid token.
    if (sessionStatus?.status === "valid") {
      redeem();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, user, token, sessionStatus?.status]);

  async function redeem() {
    setBusy(true);
    setError("");
    try {
      const response = await api.redeemWalkInQr(token);
      setResult(response);
    } catch (redeemError) {
      setError(redeemError.message || "Unable to complete check-in.");
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) {
    return <LoadingState label="Opening secure walk-in check-in…" />;
  }

  const role = String(user?.role || "").toLowerCase();
  const needsPatientLogin = !user;
  const wrongRole = Boolean(user && role !== "patient");

  return (
    <main className="walkin-page">
      <section className="walkin-card">
        <BrandMark />
        <span className="eyebrow">Clinic walk-in</span>
        <h1>Patient Check-In</h1>
        <p>Scan complete. Finish check-in with your patient account to join today’s queue.</p>

        {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}

        {result ? (
          <div className="walkin-success">
            <CheckCircle2 size={28} />
            <h2>{result.alreadyCheckedIn ? "You are already checked in." : "Check-In Successful"}</h2>
            <p>
              Queue Number: <strong>{result.queue?.queueNumber || result.queue?.token}</strong>
            </p>
            <p>
              Status: <strong>{displayQueueStatus(result.queue?.status || "waiting")}</strong>
            </p>
            <Link className="button button--primary" to="/queue">
              View my queue status
            </Link>
          </div>
        ) : null}

        {!result && sessionStatus?.status === "valid" && needsPatientLogin ? (
          <div className="walkin-actions">
            <QrCode size={22} />
            <p>Sign in with your patient account to confirm check-in. No sensitive data is stored in the QR code.</p>
            <button
              type="button"
              className="button button--primary"
              onClick={() =>
                navigate(`/login?next=${encodeURIComponent(`/walk-in-check-in?token=${token}`)}`)
              }
            >
              Sign in to check in
            </button>
          </div>
        ) : null}

        {!result && wrongRole ? (
          <div className="walkin-actions">
            <p>Walk-in QR check-in is for patient accounts. Switch to a patient login, or ask staff for help.</p>
            <Link className="button button--secondary" to="/login">
              Switch account
            </Link>
          </div>
        ) : null}

        {!result && sessionStatus?.status === "valid" && role === "patient" ? (
          <div className="walkin-actions">
            <p>{busy ? "Checking you in…" : "Confirming your appointment and queue number…"}</p>
            {!busy ? (
              <button type="button" className="button button--primary" onClick={redeem}>
                Complete check-in
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}
