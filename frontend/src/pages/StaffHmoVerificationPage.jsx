import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { StaffModal, StaffStatusBadge } from "../components/StaffUI";
import { useStaffUi } from "../components/StaffLayout";
import { formatStaffDate, formatStaffDateTime } from "../staffUtils";

function formatHmoStatus(status) {
  const value = String(status || "").toLowerCase();
  if (value === "verified") return "Verified";
  if (value === "pending_verification") return "Pending verification";
  if (value === "rejected") return "Rejected";
  return value.replaceAll("_", " ") || "Unknown";
}

function smsMessage(sms) {
  if (!sms) return "";
  if (sms.duplicate) return "HMO saved. SMS was already sent.";
  if (sms.status === "failed") return `HMO saved, but the SMS could not be sent. ${sms.reason || ""}`.trim();
  if (sms.status === "skipped") return `HMO saved. SMS skipped: ${sms.reason || "patient or clinic preference."}`;
  return "HMO saved and the patient was notified by SMS.";
}

export function StaffHmoVerificationPage() {
  const { pushToast, confirm } = useStaffUi();
  const [data, setData] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api.getStaffHmoSubmissions("pending_verification"));
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 30000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function review(submission, status) {
    const ok = await confirm({
      title: status === "verified" ? "Verify HMO coverage?" : "Reject HMO coverage?",
      message:
        status === "verified"
          ? `Mark ${submission.patientName}'s coverage as verified? This does not change appointment status.`
          : `Reject ${submission.patientName}'s HMO submission? Appointment status stays unchanged.`,
      confirmLabel: status === "verified" ? "Verify coverage" : "Reject coverage",
      tone: status === "verified" ? "primary" : "danger",
    });
    if (!ok) return;
    setBusy(`${status}-${submission.id}`);
    try {
      const response = await api.verifyStaffHmoSubmission(submission.id, { status });
      const sms = response.sms;
      const tone = sms?.status === "failed" ? "error" : "success";
      pushToast(smsMessage(sms) || "HMO verification saved.", tone);
      setDetail(response.submission || null);
      await load();
    } catch (reviewError) {
      pushToast(reviewError.message, "error");
    } finally {
      setBusy("");
    }
  }

  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading HMO submissions…" />;

  const rows = data.submissions || [];

  return (
    <div className="staff-page staff-hmo-page">
      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}

      <section className="staff-panel">
        <div className="staff-panel__heading">
          <div>
            <span className="eyebrow">Coverage review</span>
            <h2>HMO Verification</h2>
            <p>HMO submissions waiting for Staff review. Appointment confirmation never verifies coverage.</p>
          </div>
          <button className="button button--secondary" onClick={load}>
            <RefreshCw size={16} /> Refresh
          </button>
        </div>

        {rows.length ? (
          <div className="staff-table-wrap">
            <table className="staff-table staff-hmo-table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Source</th>
                  <th>Provider</th>
                  <th>Member number</th>
                  <th>Submitted</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((submission) => (
                  <tr key={submission.id}>
                    <td>
                      <strong>{submission.patientName}</strong>
                      <small>{submission.patientPhone || "No phone"}</small>
                    </td>
                    <td>
                      <strong>{submission.sourceLabel}</strong>
                      {submission.appointmentStatus ? (
                        <small>Appointment: {formatHmoStatus(submission.appointmentStatus)}</small>
                      ) : (
                        <small>No appointment or queue entry</small>
                      )}
                    </td>
                    <td>{submission.hmoProvider}</td>
                    <td>{submission.hmoMemberNumber}</td>
                    <td>{formatStaffDate(submission.submittedAt)}</td>
                    <td>
                      <StaffStatusBadge status={submission.verificationStatus} />
                    </td>
                    <td>
                      <div className="staff-row-actions">
                        <button
                          className="button button--secondary button--compact"
                          onClick={() => setDetail(submission)}
                          disabled={Boolean(busy)}
                        >
                          View
                        </button>
                        <button
                          className="button button--primary button--compact"
                          onClick={() => review(submission, "verified")}
                          disabled={Boolean(busy)}
                        >
                          Verify
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={ShieldCheck}
            title="No pending HMO submissions"
            message="Profile submissions and appointment-linked HMO details appear here until Staff verifies coverage."
          />
        )}
      </section>

      {detail ? (
        <StaffModal title="HMO submission" onClose={() => setDetail(null)}>
          <div className="staff-detail-grid staff-hmo-detail">
            <p>
              <small>Patient</small>
              <strong>{detail.patientName}</strong>
            </p>
            <p>
              <small>Source</small>
              <strong>{detail.sourceLabel}</strong>
            </p>
            <p>
              <small>Provider</small>
              <strong>{detail.hmoProvider}</strong>
            </p>
            <p>
              <small>Member number</small>
              <strong>{detail.hmoMemberNumber}</strong>
            </p>
            <p>
              <small>Submitted</small>
              <strong>{formatStaffDateTime(detail.submittedAt)}</strong>
            </p>
            <p>
              <small>HMO status</small>
              <strong>{formatHmoStatus(detail.verificationStatus)}</strong>
            </p>
            {detail.appointmentId ? (
              <p>
                <small>Linked appointment</small>
                <strong>
                  #{detail.appointmentId} · Appointment: {formatHmoStatus(detail.appointmentStatus)} · HMO:{" "}
                  {formatHmoStatus(detail.verificationStatus)}
                </strong>
              </p>
            ) : (
              <p>
                <small>Booking</small>
                <strong>Standalone profile submission — no appointment or queue entry</strong>
              </p>
            )}
            {detail.smsDeliveryStatus ? (
              <p>
                <small>SMS</small>
                <strong>{detail.smsDeliveryStatus.replaceAll("_", " ")}</strong>
              </p>
            ) : null}
          </div>
          {detail.verificationStatus === "pending_verification" ? (
            <div className="staff-heading-actions">
              <button className="button button--primary" onClick={() => review(detail, "verified")} disabled={Boolean(busy)}>
                Verify coverage
              </button>
              <button className="button button--danger" onClick={() => review(detail, "rejected")} disabled={Boolean(busy)}>
                Reject coverage
              </button>
            </div>
          ) : null}
        </StaffModal>
      ) : null}
    </div>
  );
}
