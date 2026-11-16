import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../useAuth";

function landingFor(role) {
  const value = String(role || "").toLowerCase();
  if (value === "admin") return "/admin/dashboard";
  if (value === "dentist") return "/dentist/dashboard";
  if (value === "staff") return "/staff/dashboard";
  return "/dashboard";
}

export function RecordAccessAuthorizePage() {
  const { user } = useAuth();
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [eligibility, setEligibility] = useState(null);
  const role = String(user?.role || eligibility?.role || "").toLowerCase();

  useEffect(() => {
    let cancelled = false;
    api
      .getRecordAccessApprover()
      .then((status) => {
        if (!cancelled) setEligibility(status);
      })
      .catch(() => {
        if (!cancelled) setEligibility({ eligible: false, role: String(user?.role || "").toLowerCase() });
      });
    return () => {
      cancelled = true;
    };
  }, [user?.role]);

  async function loadChallenge(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await api.previewRecordAccessChallenge(code);
      setChallenge(response.challenge);
    } catch (loadError) {
      setChallenge(null);
      setMessage(loadError.message);
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!challenge?.approvalCode) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await api.approveRecordAccessChallenge(challenge.approvalCode);
      setMessage(response.message || "Restricted records are available for the approved scope.");
      setChallenge(null);
      setCode("");
    } catch (approveError) {
      setMessage(approveError.message);
    } finally {
      setBusy(false);
    }
  }

  const eligible = eligibility?.eligible === true;

  return (
    <main className="admin-page" style={{ maxWidth: "40rem", margin: "2rem auto", padding: "0 1rem" }}>
      <p className="eyebrow">Cross-branch records</p>
      <h1>Authorize record access</h1>
      {!eligibility ? <p>Checking whether this account can authorize record access…</p> : null}
      {eligibility && !eligible ? (
        <>
          <p>
            Only an Admin or a dentist who is delegated to approve cross-branch access can use this page. Approval
            codes are entered here, not on the requesting dentist’s chart.
          </p>
          <p>Signed in as {user?.fullName || user?.email} ({role})</p>
          <p>
            <Link to={landingFor(role)}>Return to dashboard</Link>
          </p>
        </>
      ) : null}
      {eligible ? (
        <>
          <p>
            Sign in on this workstation in a separate browser profile from the requesting dentist. Enter the approval
            code shown on their screen. This page uses your account only.
          </p>
          <p>Signed in as {user?.fullName || user?.email} ({role})</p>
          <form onSubmit={loadChallenge}>
            <label>
              Approval code
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                autoComplete="off"
                required
                minLength={6}
              />
            </label>
            <button className="button button--secondary" disabled={busy} type="submit">
              {busy ? "Checking…" : "Look up request"}
            </button>
          </form>
          {challenge ? (
            <section className="admin-card" style={{ marginTop: "1.5rem" }}>
              <p>Patient {challenge.patient?.fullName || "record"} · {challenge.patient?.patientId || challenge.patient?.id}</p>
              <p>Requesting dentist {challenge.requesterName || "clinic dentist"}</p>
              <p>
                Branch {challenge.requestingBranchId} requesting {challenge.scope} from branch {challenge.originatingBranchId}
              </p>
              <p>Reason: {challenge.reason}</p>
              <button className="button button--primary" disabled={busy} type="button" onClick={approve}>
                {busy ? "Authorizing…" : "Authorize access"}
              </button>
            </section>
          ) : null}
          {message ? <p>{message}</p> : null}
          <p>
            <Link to={landingFor(role)}>Return to dashboard</Link>
          </p>
        </>
      ) : null}
    </main>
  );
}
