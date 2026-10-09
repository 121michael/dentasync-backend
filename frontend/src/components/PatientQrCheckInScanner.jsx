import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, QrCode, X } from "lucide-react";
import { api } from "../api";
import { displayQueueStatus, extractWalkInQrToken } from "../utils/walkInQr";
import { openQrCamera, startQrFrameLoop } from "../utils/scanQrFromVideo";

export function PatientQrCheckInScanner({ onCheckedIn, compact = false }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const stopLoopRef = useRef(null);
  const busyRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [manualToken, setManualToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [cameraSupported, setCameraSupported] = useState(true);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    return () => stopCamera();
  }, []);

  useEffect(() => {
    if (!open || result) return undefined;
    let cancelled = false;

    (async () => {
      try {
        const stream = await openQrCamera(videoRef.current);
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        setCameraSupported(true);
        setScanning(true);
        stopLoopRef.current = startQrFrameLoop(videoRef.current, (value) => {
          redeemToken(value);
        });
      } catch (cameraError) {
        if (cancelled) return;
        setCameraSupported(false);
        setScanning(false);
        setError(
          cameraError.message ||
            "Camera permission is required. You can also open the staff QR with your phone camera."
        );
      }
    })();

    return () => {
      cancelled = true;
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, result]);

  function stopCamera() {
    stopLoopRef.current?.();
    stopLoopRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setScanning(false);
  }

  async function redeemToken(rawValue) {
    const token = extractWalkInQrToken(rawValue);
    if (!token) {
      setError("Point the camera at the staff check-in QR. That code is not a clinic walk-in QR.");
      return;
    }
    if (busyRef.current) return;

    busyRef.current = true;
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
      busyRef.current = false;
      setBusy(false);
    }
  }

  function startScanner() {
    setOpen(true);
    setResult(null);
    setError("");
    setCameraSupported(true);
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
          <QrCode size={17} /> Scan staff QR with camera
        </button>
      ) : null}

      {open && !result ? (
        <section className="patient-qr-panel">
          <div className="patient-qr-panel__heading">
            <div>
              <span className="eyebrow">Patient camera</span>
              <h3>Hold your phone up to the staff QR on the desk screen.</h3>
              <p>Use the rear camera. Keep the whole square inside the frame until it beeps complete.</p>
            </div>
            <button type="button" className="button button--secondary button--compact" onClick={closeScanner}>
              <X size={15} /> Close
            </button>
          </div>

          <div className="patient-qr-camera">
            <video ref={videoRef} autoPlay playsInline muted />
            <div className="patient-qr-camera__frame" aria-hidden="true" />
            <span>
              <Camera size={15} /> {scanning ? "Reading staff QR…" : busy ? "Checking you in…" : "Starting camera…"}
            </span>
          </div>

          {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}

          {!cameraSupported ? (
            <p className="muted-copy">
              If the camera will not open, use the phone camera app on the staff QR, or paste the link below.
            </p>
          ) : null}

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
