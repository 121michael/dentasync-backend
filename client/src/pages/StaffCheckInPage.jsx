import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Nfc, QrCode, RefreshCw, X } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { StaffStatusBadge } from "../components/StaffUI";
import { useStaffUi } from "../components/StaffLayout";
import { formatStaffDateTime, formatStaffTime } from "../staffUtils";

export function StaffCheckInPage() {
  const { pushToast } = useStaffUi();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const scanTimerRef = useRef(null);
  const [mode, setMode] = useState("rfid");
  const [rfidCode, setRfidCode] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [verified, setVerified] = useState(null);
  const [checkIns, setCheckIns] = useState(null);
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

  useEffect(() => {
    loadLog();
    const timer = window.setInterval(loadLog, 25000);
    return () => window.clearInterval(timer);
  }, [loadLog]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (scanTimerRef.current) {
        window.clearInterval(scanTimerRef.current);
      }
    };
  }, []);

  async function runCheckIn(payload) {
    setBusy(true);
    setError("");
    setScannerState("scanning");
    try {
      const response = await api.staffCheckIn(payload);
      setVerified(response);
      setScannerState("success");
      pushToast(response.message || "Patient checked in successfully.");
      setRfidCode("");
      setManualCode("");
      await loadLog();
    } catch (checkInError) {
      setScannerState("error");
      setError(checkInError.message);
      pushToast(checkInError.message, "error");
    } finally {
      setBusy(false);
      window.setTimeout(() => setScannerState("ready"), 1800);
    }
  }

  async function submitRfid(event) {
    event.preventDefault();
    if (!rfidCode.trim()) {
      setError("Scan or enter an RFID tag / patient code.");
      return;
    }
    await runCheckIn({ method: "rfid", rfidTag: rfidCode.trim(), code: rfidCode.trim() });
  }

  async function submitManualQr(event) {
    event.preventDefault();
    if (!manualCode.trim()) {
      setError("Enter or scan a patient QR payload.");
      return;
    }
    await runCheckIn({ method: "qr", qrPayload: manualCode.trim(), code: manualCode.trim() });
  }

  async function startQrCamera() {
    setError("");
    setMode("qr");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera is not available in this browser. Use manual QR entry instead.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
      window.requestAnimationFrame(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      });

      if ("BarcodeDetector" in window) {
        const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
        scanTimerRef.current = window.setInterval(async () => {
          if (!videoRef.current || busy) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const value = codes?.[0]?.rawValue;
            if (value) {
              window.clearInterval(scanTimerRef.current);
              scanTimerRef.current = null;
              stopCamera();
              await runCheckIn({ method: "qr", qrPayload: value, code: value });
            }
          } catch {
            // Keep scanning.
          }
        }, 900);
      }
    } catch (cameraError) {
      setError(cameraError.message || "Unable to open the camera for QR scanning.");
      pushToast("Unable to open QR camera.", "error");
    }
  }

  function stopCamera() {
    if (scanTimerRef.current) {
      window.clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
  }

  if (error && !checkIns) return <ErrorState message={error} onRetry={loadLog} />;
  if (!checkIns) return <LoadingState label="Loading check-in center…" />;

  return (
    <div className="staff-page">
      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}

      <section className="staff-panel">
        <div className="staff-panel__heading">
          <div>
            <span className="eyebrow">Front desk arrival</span>
            <h2>Patient Check-In Center</h2>
            <p>Validate attendance with RFID or QR, then place patients into the live queue.</p>
          </div>
          <button className="button button--secondary" onClick={loadLog}>
            <RefreshCw size={16} /> Refresh Log
          </button>
        </div>

        <div className="admin-tabs" role="tablist" aria-label="Check-in method">
          <button
            type="button"
            className={`admin-tab ${mode === "rfid" ? "is-active" : ""}`}
            onClick={() => {
              stopCamera();
              setMode("rfid");
            }}
          >
            RFID Check-In
          </button>
          <button
            type="button"
            className={`admin-tab ${mode === "qr" ? "is-active" : ""}`}
            onClick={() => setMode("qr")}
          >
            QR Code Check-In
          </button>
        </div>

        {mode === "rfid" ? (
          <div className="staff-checkin-grid">
            <article className={`staff-scanner-card staff-scanner-card--${scannerState}`}>
              <Nfc size={34} />
              <h3>Ready for RFID Scan</h3>
              <p>
                {scannerState === "scanning"
                  ? "Verifying patient, appointment, and queue…"
                  : scannerState === "success"
                    ? "Check-in recorded."
                    : "Hold the patient card near the reader or type the RFID / patient code."}
              </p>
              <form className="admin-form" onSubmit={submitRfid}>
                <label className="field">
                  <span>RFID tag / patient code</span>
                  <input
                    value={rfidCode}
                    onChange={(event) => setRfidCode(event.target.value)}
                    placeholder="Scan RFID or enter patient ID / phone"
                    autoFocus
                  />
                </label>
                <button className="button button--primary" disabled={busy}>
                  {busy ? "Checking in…" : "Process RFID Check-In"}
                </button>
              </form>
            </article>
            <VerifiedPanel verified={verified} />
          </div>
        ) : (
          <div className="staff-checkin-grid">
            <article className="staff-scanner-card">
              <QrCode size={34} />
              <h3>Scan Patient QR Code</h3>
              <p>Use the staff device camera or paste a QR payload / appointment code.</p>
              {cameraOpen ? (
                <div className="admin-camera-panel">
                  <video ref={videoRef} autoPlay playsInline muted className="admin-camera-preview" />
                  <button type="button" className="button button--secondary" onClick={stopCamera}>
                    <X size={16} /> Close Camera
                  </button>
                </div>
              ) : (
                <button type="button" className="button button--secondary" onClick={startQrCamera}>
                  <Camera size={16} /> Open QR Camera
                </button>
              )}
              <form className="admin-form" onSubmit={submitManualQr}>
                <label className="field">
                  <span>QR payload / appointment ID</span>
                  <input
                    value={manualCode}
                    onChange={(event) => setManualCode(event.target.value)}
                    placeholder='e.g. 42 or {"appointmentId":42}'
                  />
                </label>
                <button className="button button--primary" disabled={busy}>
                  {busy ? "Verifying…" : "Verify QR Check-In"}
                </button>
              </form>
            </article>
            <VerifiedPanel verified={verified} />
          </div>
        )}
      </section>

      <section className="staff-panel staff-panel--table">
        <div className="staff-panel__heading">
          <div>
            <span className="eyebrow">Today</span>
            <h2>Check-In Log</h2>
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
          <EmptyState title="No check-ins yet" detail="RFID and QR arrivals will appear here." />
        )}
      </section>
    </div>
  );
}

function VerifiedPanel({ verified }) {
  if (!verified?.verified) {
    return (
      <article className="staff-verified-card staff-verified-card--idle">
        <h3>Awaiting verification</h3>
        <p>Successful RFID/QR check-ins show patient, appointment, and queue details here.</p>
      </article>
    );
  }

  return (
    <article className="staff-verified-card">
      <span className="eyebrow">Patient Verified</span>
      <h3>{verified.patient?.fullName}</h3>
      <div className="staff-detail-grid">
        <p>
          <small>Patient ID</small>
          <strong>{verified.patient?.id}</strong>
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
          <strong>{verified.appointment?.dentist}</strong>
        </p>
        <p>
          <small>Service</small>
          <strong>{verified.appointment?.service}</strong>
        </p>
        <p>
          <small>Queue Number</small>
          <strong>{verified.queue?.queueNumber || verified.queue?.token}</strong>
        </p>
        <p>
          <small>Check-In Time</small>
          <strong>{formatStaffDateTime(verified.queue?.checkedInAt)}</strong>
        </p>
      </div>
    </article>
  );
}
