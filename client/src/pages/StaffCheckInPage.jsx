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

function checkInToVerified(entry) {
  if (!entry) return null;
  return {
    verified: true,
    method: "rfid",
    message: "Patient checked in successfully.",
    patient: {
      id: entry.patientId,
      fullName: entry.patientName,
    },
    appointment: {
      id: entry.appointment?.id,
      service: entry.appointment?.treatment,
      dentist: entry.appointment?.dentist,
      date: entry.appointment?.date,
      time: entry.appointment?.time,
    },
    queue: {
      id: entry.id,
      token: entry.token,
      queueNumber: entry.token || entry.queueNumber,
      status: entry.status,
      waitMinutes: entry.waitMinutes,
      checkedInAt: entry.timestamp,
    },
  };
}

function eventToVerified(event) {
  if (!event || event.status !== "success") return null;
  return {
    verified: true,
    method: "rfid",
    message: event.message || "Patient checked in successfully.",
    patient: event.patient,
    appointment: event.appointment,
    queue: event.queue,
  };
}

export function StaffCheckInPage() {
  const { pushToast } = useStaffUi();
  const rfidInputRef = useRef(null);
  const seenCheckInIdsRef = useRef(new Set());
  const bootstrappedLogRef = useRef(false);
  const lastEventIdRef = useRef(0);
  const [mode, setMode] = useState("rfid");
  const [rfidCode, setRfidCode] = useState("");
  const [verified, setVerified] = useState(null);
  const [checkIns, setCheckIns] = useState(null);
  const [qrSession, setQrSession] = useState(null);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [scannerState, setScannerState] = useState("ready");
  const [listeningHint, setListeningHint] = useState("Hold the patient card on the ESP32 RFID reader.");

  const loadLog = useCallback(async () => {
    try {
      const response = await api.getStaffCheckIns();
      const rows = response.checkIns || [];
      setCheckIns(rows);

      if (!bootstrappedLogRef.current) {
        rows.forEach((row) => seenCheckInIdsRef.current.add(String(row.id)));
        bootstrappedLogRef.current = true;
        return;
      }

      const fresh = rows.find((row) => !seenCheckInIdsRef.current.has(String(row.id)));
      if (fresh) {
        rows.forEach((row) => seenCheckInIdsRef.current.add(String(row.id)));
        setVerified(checkInToVerified(fresh));
        setScannerState("success");
        setError("");
        pushToast(`${fresh.patientName} checked in · Queue ${fresh.token || fresh.queueNumber}`);
        window.setTimeout(() => setScannerState("ready"), 1600);
      }
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [pushToast]);

  const pollRfidEvents = useCallback(async () => {
    try {
      const response = await api.getStaffRfidEvents(lastEventIdRef.current);
      const events = response.events || [];
      if (!events.length) return;

      const newest = events[0];
      lastEventIdRef.current = Math.max(lastEventIdRef.current, ...events.map((event) => Number(event.id) || 0));

      if (newest.status === "success") {
        setVerified(eventToVerified(newest));
        setScannerState("success");
        setError("");
        setListeningHint("Check-in complete. Ready for the next card.");
        pushToast(newest.message || "Patient checked in from RFID tap.");
        await loadLog();
        window.setTimeout(() => setScannerState("ready"), 1800);
        return;
      }

      setScannerState("error");
      setError(newest.message || "RFID tap failed.");
      setListeningHint(newest.message || "RFID tap failed. Try again.");
      pushToast(newest.message || "RFID tap failed.", "error");
      window.setTimeout(() => setScannerState("ready"), 2200);
    } catch {
      // Keep listening even if the live feed briefly fails.
    }
  }, [loadLog, pushToast]);

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
    const logTimer = window.setInterval(loadLog, 4000);
    const eventTimer = window.setInterval(pollRfidEvents, 1500);
    pollRfidEvents();
    return () => {
      window.clearInterval(logTimer);
      window.clearInterval(eventTimer);
    };
  }, [loadLog, loadQrSession, pollRfidEvents]);

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

  // Hidden capture for USB keyboard-wedge readers only (not for typing by staff).
  useEffect(() => {
    const tag = String(rfidCode || "").trim();
    if (busy || mode !== "rfid") return undefined;
    if (!/^[A-Fa-f0-9]{6,20}$/.test(tag)) return undefined;
    const timer = window.setTimeout(() => {
      runRfidCheckIn(tag);
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rfidCode, busy, mode]);

  async function runRfidCheckIn(rawTag) {
    const tag = String(rawTag || "").trim();
    if (!tag) return;
    setBusy(true);
    setError("");
    setScannerState("scanning");
    setListeningHint("Card detected. Checking appointment…");
    try {
      const response = await api.staffCheckIn({ method: "rfid", rfidTag: tag });
      setVerified({ ...response, method: "rfid" });
      setScannerState("success");
      pushToast(response.message || "Patient checked in successfully.");
      setRfidCode("");
      await loadLog();
    } catch (checkInError) {
      setScannerState("error");
      const detail = checkInError?.data?.detail || checkInError?.data?.diagnosis?.hint;
      const message = detail
        ? `${checkInError.message}${checkInError.message.includes(detail) ? "" : ` (${detail})`}`
        : checkInError.message;
      setError(message);
      setListeningHint(message);
      pushToast(message, "error");
      setRfidCode("");
    } finally {
      setBusy(false);
      window.setTimeout(() => {
        setScannerState("ready");
        rfidInputRef.current?.focus();
      }, 1600);
    }
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
            <p>
              No typing. Patient holds their RFID card on the clinic reader (ESP32). Appointment and
              queue number appear here automatically.
            </p>
          </div>
          <button className="button button--secondary" onClick={loadLog}>
            <RefreshCw size={16} /> Refresh Log
          </button>
        </div>

        <div className="staff-checkin-hero">
          <h3>Hold card on the RFID reader</h3>
          <p>Staff does not type a name or UID. The physical reader sends the tap to DentaSync.</p>
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
              <Nfc size={42} />
              <h3>
                {scannerState === "scanning"
                  ? "Reading card…"
                  : scannerState === "success"
                    ? "Check-in complete"
                    : scannerState === "error"
                      ? "Tap failed"
                      : "Listening for card tap"}
              </h3>
              <p>{listeningHint}</p>
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
                        : "Ready — tap the ESP32 reader"}
                </span>
              </div>
              {/* Hidden capture only for USB keyboard-wedge readers. Staff should not type here. */}
              <input
                ref={rfidInputRef}
                className="sr-only"
                value={rfidCode}
                onChange={(event) => setRfidCode(event.target.value)}
                autoComplete="off"
                autoFocus
                aria-label="Hidden RFID capture"
              />
              <p className="muted-copy">
                Tap the physical ESP32 + MFRC522 reader. Do not type in this screen.
              </p>
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
            <VerifiedPanel
              verified={verified}
              emptyHint="Successful QR check-ins appear in the log and notifications as patients redeem the code."
            />
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
        <h3>Awaiting card tap</h3>
        <p>
          {emptyHint ||
            "When the patient taps the ESP32 reader, their appointment and queue number appear here. No typing."}
        </p>
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
