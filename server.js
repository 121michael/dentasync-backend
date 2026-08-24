require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
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

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || "your_super_secret_key_here";
const OTP_SECRET =
  process.env.OTP_SECRET ||
  process.env.JWT_SECRET ||
  (process.env.NODE_ENV === "production" ? null : "development-only-otp-secret");
const PASSWORD_RESET_SECRET =
  process.env.PASSWORD_RESET_SECRET ||
  OTP_SECRET ||
  (process.env.NODE_ENV === "production" ? null : "development-only-password-reset-secret");

if (!OTP_SECRET || !PASSWORD_RESET_SECRET) {
  throw new Error("OTP_SECRET and PASSWORD_RESET_SECRET must be configured in production.");
}

app.use(cors());
app.use(express.json());

// ==========================================
// REQUEST LOGGER MIDDLEWARE
// ==========================================
app.use((req, res, next) => {
  console.log(`📩 [${new Date().toLocaleTimeString()}] ${req.method} request to ${req.url}`);
  next();
});

// ==========================================
// AUTHENTICATION MIDDLEWARE
// ==========================================
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ message: "Access Denied: No Token Provided" });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: "Invalid or Expired Token" });
    req.user = user;
    next();
  });
};

// ==========================================
// REAL OTP DELIVERY SERVICES SETUP
// ==========================================
const EMAIL_PASSWORD = process.env.EMAIL_PASSWORD || process.env.EMAIL_PASS;
const EMAIL_SENDER = process.env.EMAIL_FROM || process.env.EMAIL_USER;
const transporter = process.env.EMAIL_HOST
  ? nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: Number(process.env.EMAIL_PORT || 587),
      secure:
        process.env.EMAIL_SECURE === "true" ||
        (!process.env.EMAIL_SECURE && Number(process.env.EMAIL_PORT) === 465),
      auth: {
        user: process.env.EMAIL_USER,
        pass: EMAIL_PASSWORD,
      },
    })
  : nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: EMAIL_PASSWORD,
      },
    });

function emailDeliveryIsConfigured() {
  return Boolean(process.env.EMAIL_USER && EMAIL_PASSWORD && EMAIL_SENDER);
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

async function sendEmailOtp({ to, otp, expiresAt }) {
  if (!emailDeliveryIsConfigured()) {
    throw new Error("Email delivery is not configured.");
  }

  const expiration = new Date(expiresAt);
  const minutesRemaining = Number.isNaN(expiration.getTime())
    ? 5
    : Math.max(1, Math.ceil((expiration.getTime() - Date.now()) / 60000));

  const mailOptions = {
    from: `"Amethyst Dental Clinic" <${EMAIL_SENDER}>`,
    to,
    subject: "Your DentaSync Verification Code",
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
        <h2>Welcome to DentaSync!</h2>
        <p>Your 6-digit verification code is:</p>
        <h1 style="color: #4F46E5; letter-spacing: 5px;">${otp}</h1>
        <p>This code will expire in approximately ${minutesRemaining} minute${minutesRemaining === 1 ? "" : "s"}.</p>
      </div>
    `,
  };
  return transporter.sendMail(mailOptions);
}

async function sendPasswordResetEmail({ to, token, expiresAt, recipientName }) {
  if (!emailDeliveryIsConfigured()) {
    throw new Error("Email delivery is not configured.");
  }

  const expiration = new Date(expiresAt);
  const minutesRemaining = Number.isNaN(expiration.getTime())
    ? 30
    : Math.max(1, Math.ceil((expiration.getTime() - Date.now()) / 60000));
  const resetUrl = new URL(
    process.env.FRONTEND_URL ||
      process.env.PASSWORD_RESET_URL ||
      "http://localhost:5173"
  );
  const basePath = resetUrl.pathname.replace(/\/$/, "");
  const resetPath = basePath.endsWith("/reset-password")
    ? basePath
    : `${basePath}/reset-password`;
  resetUrl.pathname = `${resetPath}/${encodeURIComponent(token)}`;
  resetUrl.search = "";
  const safeRecipientName = escapeHtml(recipientName || "there");

  return transporter.sendMail({
    from: `"Amethyst Dental Clinic" <${EMAIL_SENDER}>`,
    to,
    subject: "Password Reset Request - Amethyst Dental Clinic",
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
        <h2>Reset your password</h2>
        <p>Hello ${safeRecipientName},</p>
        <p>We received a request to reset your password for your Amethyst Dental Clinic account.</p>
        <p>
          <a href="${resetUrl.toString()}" style="display:inline-block;padding:12px 18px;border-radius:8px;color:#fff;background:#5B2A86;text-decoration:none;">
            Reset Password
          </a>
        </p>
        <p>This link expires in approximately ${minutesRemaining} minute${minutesRemaining === 1 ? "" : "s"} and can be used once.</p>
        <p>If you did not request this change, you can safely ignore this email.</p>
      </div>
    `,
  });
}

const { createClinicSmsService } = require("./services/clinicSms");
const { createCleaningReminderJob } = require("./services/cleaningReminders");

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
app.get("/", async (req, res) => {
  try {
    const result = await db.query("SELECT NOW()");
    res.json({ message: "DentaSync Backend API is running!", dbTime: result.rows[0].now });
  } catch (error) {
    res.status(500).json({ message: "Server running, but PostgreSQL failed to connect.", error: error.message });
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
    clinicSms,
  })
);

app.use(
  "/api/staff",
  createStaffPortalRouter({
    db,
    authenticateToken,
    passwordResetService,
    notifyStaff: (notification) => notifyActiveStaff(db, notification),
    clinicSms,
  })
);

app.use(
  "/api/dentist",
  createDentistPortalRouter({
    db,
    authenticateToken,
    clinicSms,
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
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ DentaSync server running on http://localhost:${PORT}`);
    console.log("Mounted APIs: /api/auth, /api/patient, /api/staff, /api/dentist, /api/admin");
    console.log("If the patient dashboard returns 404, you are not running this backend.");
    cleaningReminderJob.start();
    console.log("Cleaning reminder SMS job scheduled (every 4–6 months based on last visit).");
  });
}

module.exports = app;