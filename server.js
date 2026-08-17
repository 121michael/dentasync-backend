require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const twilio = require("twilio");
const db = require("./db");
const { createAuthRouter } = require("./routes/auth");
const { createPatientPortalRouter } = require("./routes/patientPortal");
const { createPostgresOtpStore } = require("./repositories/postgresOtpStore");
const { createOtpService } = require("./services/otpService");

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || "your_super_secret_key_here";
const OTP_SECRET =
  process.env.OTP_SECRET ||
  process.env.JWT_SECRET ||
  (process.env.NODE_ENV === "production" ? null : "development-only-otp-secret");

if (!OTP_SECRET) {
  throw new Error("OTP_SECRET must be configured in production.");
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
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function sendEmailOtp({ to, otp, expiresAt }) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    throw new Error("Email delivery is not configured.");
  }

  const expiration = new Date(expiresAt);
  const minutesRemaining = Number.isNaN(expiration.getTime())
    ? 5
    : Math.max(1, Math.ceil((expiration.getTime() - Date.now()) / 60000));

  const mailOptions = {
    from: `"DentaSync Care" <${process.env.EMAIL_USER}>`,
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

const twilioClient =
  process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;

async function sendSmsOtp(toPhone, otpCode) {
  if (!twilioClient || !process.env.TWILIO_PHONE_NUMBER) {
    console.log("⚠️ Twilio credentials missing in .env. Skipping real SMS dispatch.");
    return;
  }
  let formattedPhone = toPhone.trim();
  if (formattedPhone.startsWith("0")) {
    formattedPhone = "+63" + formattedPhone.substring(1);
  }
  return twilioClient.messages.create({
    body: `Your DentaSync verification code is: ${otpCode}. Valid for 5 minutes.`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: formattedPhone,
  });
}

const otpService = createOtpService({
  store: createPostgresOtpStore(db),
  deliverOtp: sendEmailOtp,
  otpSecret: OTP_SECRET,
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
    authenticateToken,
    jwtSecret: JWT_SECRET,
  })
);

app.use(
  "/api/patient",
  createPatientPortalRouter({
    db,
    authenticateToken,
  })
);

// ==========================================
// 3. ADMIN DASHBOARD ENDPOINTS
// ==========================================
app.get('/api/admin/users', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, CONCAT(first_name, ' ', last_name) AS name, role, email, 
       CASE WHEN is_verified THEN 'Operational' ELSE 'Pending Verification' END AS status 
       FROM users WHERE role != 'patient' AND is_archived = FALSE ORDER BY created_at DESC`
    );
    res.status(200).json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch staff users" });
  }
});

app.get('/api/admin/patients', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.id, CONCAT(u.first_name, ' ', u.last_name) AS name, 
       COALESCE(TO_CHAR(MAX(a.requested_date), 'Month DD, YYYY'), 'No Visits Yet') AS "lastVisit", 
       'Dr. Sarah Cruz' AS dentist, 
       CASE WHEN u.is_verified THEN 'Cleared' ELSE 'Pending' END AS status 
       FROM users u LEFT JOIN appointments a ON u.phone = a.phone 
       WHERE u.role = 'patient' AND u.is_archived = FALSE 
       GROUP BY u.id, u.first_name, u.last_name, u.is_verified ORDER BY u.created_at DESC`
    );
    res.status(200).json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch patient records" });
  }
});

app.get('/api/admin/archived', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, CONCAT(first_name, ' ', last_name) AS name, role, email, 'Archived Vault' AS hierarchy 
       FROM users WHERE is_archived = TRUE ORDER BY created_at DESC`
    );
    res.status(200).json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch archived records" });
  }
});

// ==========================================
// 4. EXTERNAL ROUTE MODULES
// ==========================================
// app.use("/api/appointments", require("./routes/appointments"));
// app.use("/api/users", require("./routes/users"));

// ==========================================
// 5. SERVER LISTENER (Always place at the bottom)
// ==========================================
const PORT = process.env.PORT || 5000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ DentaSync server running on http://localhost:${PORT}`);
  });
}

module.exports = app;