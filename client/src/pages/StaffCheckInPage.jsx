import { useCallback, useEffect, useRef, useState } from "react";
import { Nfc, QrCode, RefreshCw, ShieldCheck } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { StaffStatusBadge } from "../components/StaffUI";
import { useStaffUi } from "../components/StaffLayout";
import { formatStaffDateTime, formatStaffTime } from "../staffUtils";

function secondsLeft(expiresAt) {
  if (!expiresAt) return 0;
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

function formatCountdown(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function StaffCheckInPage() {
  const { pushToast } = useStaffUi();
  const rfidInputRef = useRef(null);
  const [mode, setMode] = useState("rfid");
  const [rfidCode, setRfidCode] = useState("");
  const [verified, setVerified] = useState(null);
  const [checkIns, setCheckIns] = useState(null);
  const [qrSession, setQrSession] = useState(null);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [scannerState, setScannerState] = useState("ready");

  const loadLog = useCallback(async () => {
    try {
      const response = await api.getStaffCheckIns();
      setCheckIns(response.checkIns || []);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  const loadQrSession = useCallback(async () => {
    try {
      const response = await api.getStaffWalkInQrSession();
      setQrSession(response.session || null);
    } catch {
      setQrSession(null);
    }
  }, []);

  useEffect(() => {
    loadLog();
    loadQrSession();
    const timer = window.setInterval(loadLog, 25000);
    return () => window.clearInterval(timer);
  }, [loadLog, loadQrSession]);

  useEffect(() => {
    if (mode === "rfid") {
      window.setTimeout(() => rfidInputRef.current?.focus(), 50);
    }
  }, [mode, scannerState]);

  useEffect(() => {
    if (!qrSession?.expiresAt) {
      setCountdown(0);
      return undefined;
    }
    const tick = () => {
      const remaining = secondsLeft(qrSession.expiresAt);
      setCountdown(remaining);
      if (remaining <= 0) {
        setQrSession(null);
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [qrSession]);

  async function runRfidCheckIn(rawTag) {
    const tag = String(rawTag || "").trim();
    if (!tag) {
      setError("Tap a patient RFID card on the reader.");
      return;
    }
    setBusy(true);
    setError("");
    setScannerState("scanning");
    try {
      const response = await api.staffCheckIn({ method: "rfid", rfidTag: tag });
      setVerified({ ...response, method: "rfid" });
      setScannerState("success");
      pushToast(response.message || "Patient checked in successfully.");
      setRfidCode("");
      await loadLog();
    } catch (checkInError) {
      setScannerState("error");
      setError(checkInError.message);
      pushToast(checkInError.message, "error");
      setRfidCode("");
    } finally {
      setBusy(false);
      window.setTimeout(() => {
        setScannerState("ready");
        rfidInputRef.current?.focus();
      }, 1600);
    }
  }

  async function submitRfid(event) {
    event.preventDefault();
    await runRfidCheckIn(rfidCode);
  }

  async function generateQr() {
    setBusy(true);
    setError("");
    try {
      const response = await api.createStaffWalkInQrSession();
      setQrSession(response.session);
      setMode("qr");
      pushToast(response.message || "Walk-in QR code ready for patients.");
    } catch (qrError) {
      setError(qrError.message);
      pushToast(qrError.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function revokeQr() {
    if (!qrSession?.id) return;
    setBusy(true);
    try {
      await api.revokeStaffWalkInQrSession(qrSession.id);
      setQrSession(null);
      pushToast("Walk-in QR code revoked.");
    } catch (revokeError) {
      pushToast(revokeError.message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (error && !checkIns) return <ErrorState message={error} onRetry={loadLog} />;
  if (!checkIns) return <LoadingState label="Loading check-in center…" />;

  return (
    <div className="staff-page">
      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}

      <section className="staff-panel">
        <div className="staff-panel__heading">
          <div>
            <span className="eyebrow">Walk-in arrival</span>
            <h2>Patient Check-In</h2>
            <p>Welcome patients as they enter the clinic. RFID is primary; QR is for patients without a card.</p>
          </div>
          <button className="button button--secondary" onClick={loadLog}>
            <RefreshCw size={16} /> Refresh Log
          </button>
        </div>

        <div className="staff-checkin-hero">
          <h3>Welcome. Please check in.</h3>
          <p>Patient taps RFID if they have a card. If not, staff shows a temporary QR for the patient to scan.</p>
        </div>

        <div className="admin-tabs" role="tablist" aria-label="Check-in method">
          <button
            type="button"
            className={`admin-tab ${mode === "rfid" ? "is-active" : ""}`}
            onClick={() => setMode("rfid")}
          >
            Tap RFID Card
          </button>
          <button
            type="button"
            className={`admin-tab ${mode === "qr" ? "is-active" : ""}`}
            onClick={() => setMode("qr")}
          >
            No RFID? Use QR Code
          </button>
        </div>

        {mode === "rfid" ? (
          <div className="staff-checkin-grid">
            <article className={`staff-scanner-card staff-scanner-card--${scannerState}`}>
              <Nfc size={34} />
              <h3>Tap your RFID card</h3>
              <p>
                {scannerState === "scanning"
                  ? "Verifying patient and appointment…"
                  : scannerState === "success"
                    ? "Check-in recorded. Queue number issued."
                    : scannerState === "error"
                      ? "RFID check-in failed. Try again or use QR."
                      : "Patient: hold your RFID card on the reader. Staff does not need to type a name."}
              </p>
              <div className={`staff-rfid-status staff-rfid-status--${scannerState}`}>
                <ShieldCheck size={16} />
                <span>
                  Reader status:{" "}
                  {scannerState === "scanning"
                    ? "Reading"
                    : scannerState === "success"
                      ? "Success"
                      : scannerState === "error"
                        ? "Error"
                        : "Ready"}
                </span>
              </div>
              <form className="admin-form" onSubmit={submitRfid}>
                <label className="field">
                  <span className="sr-only">RFID tag</span>
                  <input
                    ref={rfidInputRef}
                    value={rfidCode}
                    onChange={(event) => setRfidCode(event.target.value)}
                    placeholder="Waiting for RFID tap…"
                    autoComplete="off"
                    autoFocus
                    disabled={busy}
                  />
                </label>
                <button className="button button--primary" disabled={busy || !rfidCode.trim()}>
                  {busy ? "Checking in…" : "Complete RFID Check-In"}
                </button>
              </form>
              <p className="muted-copy">RFID cards are assigned by Admin. Check-in never creates a new RFID.</p>
            </article>
            <VerifiedPanel verified={verified} />
          </div>
        ) : (
          <div className="staff-checkin-grid">
            <article className="staff-scanner-card staff-scanner-card--qr">
              <QrCode size={34} />
              <h3>Staff-generated QR check-in</h3>
              <p>Generate a temporary clinic QR. The patient scans it with their phone and signs in to finish check-in.</p>
              {qrSession?.qrDataUrl && countdown > 0 ? (
                <div className="staff-walkin-qr">
                  <img src={qrSession.qrDataUrl} alt="Temporary walk-in check-in QR code" />
                  <strong>Please scan this QR code using your phone.</strong>
                  <small>Expires in {formatCountdown(countdown)}</small>
                  <div className="staff-heading-actions">
                    <button type="button" className="button button--secondary" onClick={generateQr} disabled={busy}>
                      Generate new QR
                    </button>
                    <button type="button" className="button button--danger" onClick={revokeQr} disabled={busy}>
                      Revoke QR
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="button button--primary" onClick={generateQr} disabled={busy}>
                  <QrCode size={16} /> Generate QR Check-In
                </button>
              )}
              <p className="muted-copy">
                The QR contains only a secure temporary token — never patient passwords or clinical data.
              </p>
            </article>
            <VerifiedPanel verified={verified} emptyHint="Successful QR check-ins appear in the log and notifications as patients redeem the code." />
          </div>
        )}
      </section>

      <section className="staff-panel staff-panel--table">
        <div className="staff-panel__heading">
          <div>
            <span className="eyebrow">Today</span>
            <h2>Check-In Log</h2>
            <p>Successful walk-ins join the existing Queue Management list with a real queue number.</p>
          </div>
        </div>
        {checkIns.length ? (
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>Queue #</th>
                  <th>Patient</th>
                  <th>Service</th>
                  <th>Dentist</th>
                  <th>Time</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {checkIns.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <code>{entry.token || entry.queueNumber}</code>
                    </td>
                    <td>
                      <strong>{entry.patientName}</strong>
                    </td>
                    <td>{entry.appointment?.treatment || "—"}</td>
                    <td>{entry.appointment?.dentist || "—"}</td>
                    <td>{formatStaffDateTime(entry.timestamp)}</td>
                    <td>
                      <StaffStatusBadge status={entry.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No check-ins yet" detail="RFID taps and QR walk-ins will appear here." />
        )}
      </section>
    </div>
  );
}

function VerifiedPanel({ verified, emptyHint }) {
  if (!verified?.verified) {
    return (
      <article className="staff-verified-card staff-verified-card--idle">
        <h3>Awaiting check-in</h3>
        <p>{emptyHint || "Successful RFID check-ins show patient, appointment, and queue details here."}</p>
      </article>
    );
  }

  return (
    <article className="staff-verified-card">
      <span className="eyebrow">Check-In Successful</span>
      <h3>{verified.patient?.fullName}</h3>
      <div className="staff-detail-grid">
        <p>
          <small>Method</small>
          <strong>{String(verified.method || "rfid").toUpperCase()}</strong>
        </p>
        <p>
          <small>Queue Number</small>
          <strong>{verified.queue?.queueNumber || verified.queue?.token}</strong>
        </p>
        <p>
          <small>Appointment</small>
          <strong>
            {formatStaffTime(String(verified.appointment?.time || "").slice(0, 5))} ·{" "}
            {verified.appointment?.service}
          </strong>
        </p>
        <p>
          <small>Dentist</small>
          <strong>{verified.appointment?.dentist || "—"}</strong>
        </p>
        <p>
          <small>Check-In Time</small>
          <strong>{formatStaffDateTime(verified.queue?.checkedInAt)}</strong>
        </p>
        <p>
          <small>Status</small>
          <strong>{verified.message}</strong>
        </p>
      </div>
    </article>
  );
}
