// Local `npm start` must never die silently on Windows. Force development before
// dotenv/auth so template JWT_SECRET + npm's NODE_ENV=production cannot crash
// require-time secret checks. Production deploys should use `npm run start:prod`
// with DENTASYNC_PRODUCTION=true (or strong secrets + NODE_ENV=production).
(function forceLocalNpmStartEnv() {
  const lifecycle = String(process.env.npm_lifecycle_event || "");
  // Only the local start scripts — never `start:prod`.
  const fromNpmStart = lifecycle === "start" || lifecycle === "start:backend";
  if (!fromNpmStart) return;
  if (process.env.DENTASYNC_PRODUCTION === "true") return;
  process.env.NODE_ENV = "development";
})();

console.log("[DentaSync] loading server.js ...");

try {
  const fs = require("node:fs");
  const path = require("node:path");
  fs.appendFileSync(
    path.join(__dirname, "dentasync-start.log"),
    `server_boot=${new Date().toISOString()} node=${process.version} cwd=${process.cwd()} NODE_ENV=${process.env.NODE_ENV || ""} npm_lifecycle_event=${process.env.npm_lifecycle_event || ""}\n`,
    "utf8"
  );
} catch (_) {
  // ignore log write failures
}

require("./loadEnv").loadEnv();

// Belt-and-suspenders: also downgrade production+weak-secret npm boots.
const {
  normalizeLocalNpmStartEnv,
  resolveAppSecrets,
  createCorsOptions,
  applySecurityHeaders,
} = require("./lib/securityConfig");
if (normalizeLocalNpmStartEnv(process.env).changed) {
  console.warn(
    "⚠️ npm start had NODE_ENV=production without a strong JWT_SECRET; using development mode so the API can boot. Set a real JWT_SECRET (16+ chars, not a template placeholder) and NODE_ENV=production for production."
  );
}

const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const db = require("./db");
const { createAuthRouter } = require("./routes/auth");
const { createPatientPortalRouter } = require("./routes/patientPortal");
const { createStaffPortalRouter } = require("./routes/staffPortal");
const { createAdminPortalRouter } = require("./routes/adminPortal");
const { createDentistPortalRouter } = require("./routes/dentistPortal");
const { createPostgresOtpStore } = require("./repositories/postgresOtpStore");
const { createPostgresPasswordResetStore } = require("./repositories/postgresPasswordResetStore");
const { createOtpService } = require("./services/otpService");
const { createPasswordResetService } = require("./services/passwordResetService");
const { notifyActiveStaff } = require("./services/staffNotifications");
const { notifyActiveAdmins } = require("./services/adminNotifications");
const { notifyDentists } = require("./services/dentistNotifications");
const {
  emailDeliveryIsConfigured,
  getMailConfig,
  probeGmailHttpsRelay,
  sendEmailOtp,
  sendPasswordResetEmail,
} = require("./services/emailDelivery");
const { authenticateToken } = require("./middleware/authMiddleware");

const app = express();
const { jwtSecret: JWT_SECRET, otpSecret: OTP_SECRET, passwordResetSecret: PASSWORD_RESET_SECRET } =
  resolveAppSecrets(process.env);

if (process.env.TRUST_PROXY === "true" || process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

const corsOptions = createCorsOptions(process.env);
app.use(
  cors({
    origin: corsOptions.origin,
    credentials: corsOptions.credentials,
  })
);
app.use(applySecurityHeaders);
app.use(express.json({ limit: "1mb" }));

// ==========================================
// REQUEST LOGGER MIDDLEWARE
// ==========================================
app.use((req, res, next) => {
  console.log(`📩 [${new Date().toLocaleTimeString()}] ${req.method} request to ${req.url}`);
  next();
});

const { createClinicSmsService } = require("./services/clinicSms");
const { createCleaningReminderJob } = require("./services/cleaningReminders");
const { createDocumentSyncCleanupJob } = require("./services/documentSyncCleanupJob");
const path = require("path");

const clinicSms = createClinicSmsService({
  db,
  semaphoreApiKey: process.env.SEMAPHORE_API_KEY || null,
  semaphoreSenderName: process.env.SEMAPHORE_SENDER_NAME || null,
  clinicName: process.env.CLINIC_NAME || "Amethyst Dental Clinic",
});
app.locals.clinicSms = clinicSms;
app.locals.sendClinicSms = (phone, message) =>
  clinicSms.sendClinicSms({
    phone,
    message,
    messageType: "manual",
    category: "general",
    respectPreferences: false,
  });

async function sendSmsOtp(toPhone, otpCode) {
  const result = await clinicSms.sendClinicSms({
    phone: toPhone,
    message: `Your DentaSync verification code is: ${otpCode}. Valid for 5 minutes.`,
    messageType: "otp",
    category: "otp",
    respectPreferences: false,
    actorRole: "system",
    actorId: "otp",
  });
  if (result.status === "failed" || result.status === "skipped") {
    console.log("⚠️ OTP SMS not sent:", result.reason || result.status);
  }
  return result;
}

const otpService = createOtpService({
  store: createPostgresOtpStore(db),
  deliverOtp: sendEmailOtp,
  otpSecret: OTP_SECRET,
});
const passwordResetService = createPasswordResetService({
  store: createPostgresPasswordResetStore(db),
  deliverResetLink: sendPasswordResetEmail,
  passwordResetSecret: PASSWORD_RESET_SECRET,
});

// ==========================================
// 1. HEALTH CHECK
// ==========================================
app.get("/api/auth/otp-mail-status", async (_req, res) => {
  const mail = getMailConfig();
  try {
    const probe = await probeGmailHttpsRelay();
    return res.json({
      httpsRelayConfigured: Boolean(mail.httpsRelayConfigured),
      smtpConfigured: Boolean(mail.smtpConfigured),
      probe: probe
        ? {
            status: probe.status,
            scriptReached: probe.scriptReached,
            body: probe.body,
          }
        : null,
    });
  } catch (error) {
    return res.status(500).json({
      httpsRelayConfigured: Boolean(mail.httpsRelayConfigured),
      error: error.message,
    });
  }
});

app.get("/", async (req, res) => {
  try {
    const result = await db.query("SELECT NOW()");
    res.json({ message: "DentaSync Backend API is running!", dbTime: result.rows[0].now });
  } catch (error) {
    res.status(500).json({ message: "Server running, but PostgreSQL failed to connect.", error: error.message });
  }
});

// Public waiting-room board (no private medical details).
app.get("/api/public/walk-in-check-in/:token", async (req, res) => {
  try {
    const staffWalkInQr = require("./services/staffWalkInQr");
    const validity = await staffWalkInQr.findValidWalkInQrSession(db, req.params.token);
    if (validity.status !== "valid") {
      return res.status(validity.status === "invalid" ? 404 : 410).json({
        status: validity.status,
        message:
          validity.status === "expired"
            ? "QR code expired. Please ask clinic staff to generate a new check-in QR."
            : validity.status === "revoked"
              ? "This QR code is no longer active."
              : "This QR code is not valid.",
        expiresAt: validity.session?.expires_at || null,
      });
    }
    return res.json({
      status: "valid",
      expiresAt: validity.session.expires_at,
      message: "Sign in with your patient account to complete clinic check-in.",
    });
  } catch (error) {
    if (error?.code === "42P01") {
      return res.status(503).json({ message: "Walk-in QR check-in is not available yet." });
    }
    console.error("Public walk-in QR validate error:", error.message);
    return res.status(500).json({ message: "Unable to validate the walk-in QR code." });
  }
});

app.get("/api/public/queue-display", async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT
         queue.token,
         queue.position,
         queue.status,
         queue.estimated_wait_minutes,
         appointment.service_name,
         appointment.dentist_name
       FROM patient_portal_queue_entries AS queue
       LEFT JOIN patient_portal_appointments AS appointment
         ON appointment.id = queue.appointment_id
       WHERE DATE(queue.checked_in_at) = CURRENT_DATE
         AND queue.status <> 'completed'
       ORDER BY
         CASE queue.status
           WHEN 'dentist' THEN 0
           WHEN 'preparing' THEN 1
           WHEN 'waiting' THEN 2
           ELSE 3
         END,
         queue.position ASC
       LIMIT 40`
    );

    const rows = result.rows.map((row) => ({
      token: row.token,
      position: row.position,
      status: row.status === "dentist" ? "in_chair" : row.status,
      estimatedWaitMinutes: Number(row.estimated_wait_minutes || 0),
      procedure: row.service_name || "Dental visit",
      dentist: row.dentist_name || "Clinic team",
    }));

    const nowServing = rows.find((row) => row.status === "in_chair") || rows[0] || null;
    const upNext = rows.filter((row) => row.token !== nowServing?.token).slice(0, 8);

    return res.json({
      clinicName: process.env.CLINIC_NAME || "Amethyst Dental Clinic",
      updatedAt: new Date().toISOString(),
      nowServing,
      upNext,
      queue: rows,
    });
  } catch (error) {
    if (error?.code === "42P01") {
      return res.json({
        clinicName: process.env.CLINIC_NAME || "Amethyst Dental Clinic",
        updatedAt: new Date().toISOString(),
        nowServing: null,
        upNext: [],
        queue: [],
      });
    }
    console.error("Queue display error:", error.message);
    return res.status(500).json({ message: "Unable to load the queue display." });
  }
});

// ==========================================
// 2. AUTHENTICATION & USER MANAGEMENT
// ==========================================

app.use(
  "/api/auth",
  createAuthRouter({
    db,
    otpService,
    passwordResetService,
    authenticateToken,
    jwtSecret: JWT_SECRET,
  })
);

app.use(
  "/api/patient",
  createPatientPortalRouter({
    db,
    authenticateToken,
    notifyStaff: (notification) => notifyActiveStaff(db, notification),
    notifyAdmin: (notification) => notifyActiveAdmins(db, notification),
    notifyDentist: (notification) => notifyDentists(db, notification),
    clinicSms,
    jwtSecret: JWT_SECRET,
  })
);

app.use(
  "/api/staff",
  createStaffPortalRouter({
    db,
    authenticateToken,
    passwordResetService,
    notifyStaff: (notification) => notifyActiveStaff(db, notification),
    notifyDentist: (notification) => notifyDentists(db, notification),
    clinicSms,
  })
);

app.use(
  "/api/dentist",
  createDentistPortalRouter({
    db,
    authenticateToken,
    clinicSms,
    notifyDentist: (notification) => notifyDentists(db, notification),
  })
);

app.use(
  "/api/admin",
  createAdminPortalRouter({
    db,
    authenticateToken,
    passwordResetService,
    emailDeliveryIsConfigured,
    notifyAdmin: (notification) => notifyActiveAdmins(db, notification),
    clinicSms,
  })
);

// ==========================================
// 4. EXTERNAL ROUTE MODULES
// ==========================================
// app.use("/api/appointments", require("./routes/appointments"));
// app.use("/api/users", require("./routes/users"));

// ==========================================
// 5. SERVER LISTENER (Always place at the bottom)
// ==========================================
const PORT = process.env.PORT || 5000;
const cleaningReminderJob = createCleaningReminderJob({ db, clinicSms });
const documentSyncCleanupJob = createDocumentSyncCleanupJob({
  db,
  uploadDirectory: path.join(process.cwd(), "uploads", "admin-document-sync"),
});
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ DentaSync server running on http://localhost:${PORT}`);
    console.log("Mounted APIs: /api/auth, /api/patient, /api/staff, /api/dentist, /api/admin");
    console.log("If the patient dashboard returns 404, you are not running this backend.");
    if (process.env.SEMAPHORE_API_KEY) {
      console.log("Clinic SMS: Semaphore API key loaded.");
    } else {
      console.log("Clinic SMS: SEMAPHORE_API_KEY is missing — staff/patient SMS will fail.");
    }
    if (emailDeliveryIsConfigured()) {
      const mail = getMailConfig();
      if (mail.httpsRelayConfigured) {
        console.log("Clinic email OTP: Gmail HTTPS relay ready (Render Free compatible).");
        probeGmailHttpsRelay()
          .then((probe) => {
            if (!probe) return;
            if (probe.scriptReached) {
              console.log(
                `Clinic email OTP probe: Apps Script responded HTTP ${probe.status} (${probe.body})`
              );
            } else {
              console.log(
                `Clinic email OTP probe: URL did not run doPost HTTP ${probe.status} (${probe.body}). Copy the Web App URL that ends with /exec.`
              );
            }
          })
          .catch((error) => {
            console.log(`Clinic email OTP probe failed: ${error.message}`);
          });
      } else {
        console.log(`Clinic email OTP: Gmail SMTP ready (${mail.from}).`);
      }
    } else {
      console.log(
        "Clinic email OTP: set GMAIL_APPS_SCRIPT_URL on Render Free, or EMAIL_USER / EMAIL_PASS for local SMTP."
      );
    }
    cleaningReminderJob.start();
    documentSyncCleanupJob.start();
    console.log("Cleaning reminder SMS job scheduled (every 4–6 months based on last visit).");
    console.log("Document sync temporary scans expire after 24 hours (server clock).");
  });
}

module.exports = app;