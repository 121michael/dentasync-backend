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

function roleBlockedFromAuthorize(role) {
  const value = String(role || "").toLowerCase();
  return value === "patient" || value === "staff";
}

export function RecordAccessAuthorizePage() {
  const { user } = useAuth();
  const [code, setCode] = useState("");
  const [secret, setSecret] = useState("");
  const [challenge, setChallenge] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [eligibility, setEligibility] = useState(null);
  const role = String(user?.role || eligibility?.role || "").toLowerCase();
  const blockedByRole = roleBlockedFromAuthorize(role);
  const isAdmin = role === "admin";
  const eligible = isAdmin || (!blockedByRole && eligibility?.eligible === true);
  const denied = blockedByRole || (!isAdmin && eligibility?.eligible === false);

  useEffect(() => {
    if (blockedByRole || isAdmin) return undefined;
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
  }, [blockedByRole, isAdmin, user?.role]);

  async function loadChallenge(event) {
    event.preventDefault();
    if (!eligible) return;
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
    if (!eligible || !challenge?.approvalCode) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await api.approveRecordAccessChallenge(
        challenge.approvalCode,
        eligibility?.requiresApprovalCredential ? { secret } : {}
      );
      setMessage(response.message || "Restricted records are available for the approved scope.");
      setChallenge(null);
      setCode("");
      setSecret("");
    } catch (approveError) {
      setMessage(approveError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="admin-page" style={{ maxWidth: "40rem", margin: "2rem auto", padding: "0 1rem" }}>
      <p className="eyebrow">Cross-branch records</p>
      <h1>Authorize record access</h1>
      {denied ? (
        <>
          <h2>Access denied</h2>
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
      {!denied && !eligible ? <p>Checking whether this account can authorize record access…</p> : null}
      {eligible ? (
        <>
          <p>
            Sign in on this workstation in a separate browser profile from the requesting dentist. Enter the approval
            code shown on their screen. This page uses your account only. Do not type the credential on the requesting
            dentist’s chart.
          </p>
          <p>Signed in as {user?.fullName || user?.email} ({role})</p>
          {eligibility?.approvalCredentialIdentifier ? (
            <p>Optional identifier: verified PRC {eligibility.approvalCredentialIdentifier}</p>
          ) : null}
          {eligibility?.requiresApprovalCredential && eligibility?.approvalCredentialStatus !== "active" ? (
            <p>Set your approval PIN on Professional Profile before authorizing access.</p>
          ) : null}
          <form className="record-access-authorize__fields" onSubmit={loadChallenge}>
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
            <section className="admin-card record-access-authorize__fields" style={{ marginTop: "1.5rem" }}>
              <p>Patient {challenge.patient?.fullName || "record"} · {challenge.patient?.patientId || challenge.patient?.id}</p>
              <p>Requesting dentist {challenge.requesterName || "clinic dentist"}</p>
              <p>
                Branch {challenge.requestingBranchId} requesting {challenge.scope} from branch {challenge.originatingBranchId}
              </p>
              <p>Reason: {challenge.reason}</p>
              {eligibility?.requiresApprovalCredential ? (
                <label>
                  Your approval PIN or passphrase
                  <input
                    type="password"
                    autoComplete="off"
                    value={secret}
                    onChange={(event) => setSecret(event.target.value)}
                    required
                    minLength={8}
                  />
                </label>
              ) : null}
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
