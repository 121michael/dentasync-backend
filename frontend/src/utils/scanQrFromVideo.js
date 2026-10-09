import jsQR from "jsqr";

export async function openQrCamera(videoEl) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser cannot open the camera. Open the staff QR with your phone camera instead.");
  }

  const constraints = [
    {
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    },
    { audio: false, video: { facingMode: "environment" } },
    { audio: false, video: true },
  ];

  let lastError = null;
  for (const constraint of constraints) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraint);
      if (videoEl) {
        videoEl.srcObject = stream;
        videoEl.setAttribute("playsinline", "true");
        videoEl.muted = true;
        await videoEl.play().catch(() => undefined);
      }
      return stream;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Camera permission is required to scan the clinic QR code.");
}

export function startQrFrameLoop(videoEl, onCode) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  let raf = 0;
  let stopped = false;
  let lastValue = "";
  let lastAt = 0;

  const tick = () => {
    if (stopped) return;
    if (videoEl.readyState >= 2 && videoEl.videoWidth && context) {
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      context.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      const frame = context.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "attemptBoth" });
      const value = String(code?.data || "").trim();
      const now = Date.now();
      if (value && (value !== lastValue || now - lastAt > 2500)) {
        lastValue = value;
        lastAt = now;
        onCode(value);
      }
    }
    raf = window.requestAnimationFrame(tick);
  };

  raf = window.requestAnimationFrame(tick);
  return () => {
    stopped = true;
    window.cancelAnimationFrame(raf);
  };
}
