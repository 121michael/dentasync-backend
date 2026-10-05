import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, QrCode, X } from "lucide-react";
import { api } from "../api";
import { displayQueueStatus, extractWalkInQrToken } from "../utils/walkInQr";

export function PatientQrCheckInScanner({ onCheckedIn, compact = false }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const scanTimerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [manualToken, setManualToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [cameraSupported, setCameraSupported] = useState(true);

  useEffect(() => {
    return () => stopCamera();
  }, []);

  function stopCamera() {
    if (scanTimerRef.current) {
      window.clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }

  async function redeemToken(rawValue) {
    const token = extractWalkInQrToken(rawValue);
    if (!token) {
      setError("That QR code is not a clinic check-in code. Ask staff for the check-in QR.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const response = await api.redeemWalkInQr(token);
      setResult(response);
      stopCamera();
      onCheckedIn?.(response);
    } catch (redeemError) {
      setError(
        redeemError.message ||
          "QR code expired. Please ask clinic staff to generate a new check-in QR."
      );
    } finally {
      setBusy(false);
    }
  }

  async function startScanner() {
    setOpen(true);
    setResult(null);
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraSupported(false);
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraSupported(true);
      window.requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
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
              await redeemToken(value);
            }
          } catch {
            // Keep scanning until a valid frame is read.
          }
        }, 700);
      } else {
        setError("Live camera QR reading is not supported in this browser. Paste the QR link below.");
      }
    } catch (cameraError) {
      setCameraSupported(false);
      setError(cameraError.message || "Camera permission is required to scan the clinic QR code.");
    }
  }

  function closeScanner() {
    stopCamera();
    setOpen(false);
    setManualToken("");
    setError("");
  }

  return (
    <div className={`patient-qr-checkin ${compact ? "patient-qr-checkin--compact" : ""}`}>
      {!open && !result ? (
        <button type="button" className="button button--primary" onClick={startScanner}>
          <QrCode size={17} /> Scan QR to Check In
        </button>
      ) : null}

      {open && !result ? (
        <section className="patient-qr-panel">
          <div className="patient-qr-panel__heading">
            <div>
              <span className="eyebrow">Open QR scanner</span>
              <h3>Point your camera at the clinic check-in QR code.</h3>
              <p>Staff displays the QR. You scan it here — do not generate your own clinic QR.</p>
            </div>
            <button type="button" className="button button--secondary button--compact" onClick={closeScanner}>
              <X size={15} /> Close
            </button>
          </div>

          {cameraSupported ? (
            <div className="patient-qr-camera">
              <video ref={videoRef} autoPlay playsInline muted />
              <span>
                <Camera size={15} /> Camera active
              </span>
            </div>
          ) : null}

          {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}

          <form
            className="patient-qr-manual"
            onSubmit={(event) => {
              event.preventDefault();
              redeemToken(manualToken);
            }}
          >
            <label className="field">
              <span>Or paste the QR link / token</span>
              <input
                value={manualToken}
                onChange={(event) => setManualToken(event.target.value)}
                placeholder="Paste check-in link from staff QR"
                disabled={busy}
              />
            </label>
            <button className="button button--primary" disabled={busy || !manualToken.trim()}>
              {busy ? "Checking in…" : "Complete check-in"}
            </button>
          </form>
        </section>
      ) : null}

      {result ? (
        <section className="patient-qr-success">
          <CheckCircle2 size={26} />
          <h3>{result.alreadyCheckedIn ? "You are already checked in." : "Check-In Successful"}</h3>
          <p>
            Queue Number: <strong>{result.queue?.queueNumber || result.queue?.token}</strong>
          </p>
          <p>
            Status: <strong>{displayQueueStatus(result.queue?.status || "waiting")}</strong>
          </p>
          <button type="button" className="button button--secondary button--compact" onClick={closeScanner}>
            Done
          </button>
        </section>
      ) : null}
    </div>
  );
}
