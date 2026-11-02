require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("./db");
const { createAuthRouter } = require("./routes/auth");
const { createPostgresOtpStore } = require("./repositories/postgresOtpStore");
const { createOtpService } = require("./services/otpService");
const {
  emailDeliveryIsConfigured,
  getMailConfig,
  probeGmailHttpsRelay,
  sendEmailOtp,
} = require("./services/emailDelivery");
const { applyTrustedProxy } = require("./lib/httpSecurity");

const app = express();
applyTrustedProxy(app);
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

app.use((req, res, next) => {
  console.log(`📩 [${new Date().toLocaleTimeString()}] ${req.method} request to ${req.url}`);
  next();
});

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return res.status(401).json({ message: "Access Denied: No Token Provided" });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: "Invalid or Expired Token" });
    req.user = user;
    next();
  });
};

const otpService = createOtpService({
  store: createPostgresOtpStore(db),
  deliverOtp: sendEmailOtp,
  otpSecret: OTP_SECRET,
});

app.get("/", async (req, res) => {
  try {
    const result = await db.query("SELECT NOW()");
    res.json({ message: "DentaSync Backend API is running!", dbTime: result.rows[0].now });
  } catch (error) {
    res.status(500).json({
      message: "Server running, but PostgreSQL failed to connect.",
      error: error.message,
    });
  }
});

app.get("/api/auth/seed-users", async (req, res) => {
  try {
    const hashedPassword = await bcrypt.hash("password123", 10);

    const insertQuery = `
      INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status) 
      VALUES 
        ('System', 'Admin', 'admin@dentasync.com', '09111111111', $1, 'admin', TRUE, 'Active'),
        ('Clinic', 'Staff', 'staff@dentasync.com', '09222222222', $1, 'staff', TRUE, 'Active'),
        ('Test', 'Patient', 'patient@dentasync.com', '09333333333', $1, 'patient', TRUE, 'Active')
      ON CONFLICT (email) DO UPDATE SET 
        password_hash = EXCLUDED.password_hash,
        is_verified = TRUE,
        status = 'Active'
      RETURNING id, first_name, last_name, email, role;
    `;

    const result = await db.query(insertQuery, [hashedPassword]);

    res.status(200).json({
      message: 'Test users seeded and passwords set to "password123" successfully!',
      users: result.rows,
    });
  } catch (error) {
    console.error("Seeding error:", error);
    res.status(500).json({ message: "Failed to seed users", error: error.message });
  }
});

app.use(
  "/api/auth",
  createAuthRouter({
    db,
    otpService,
    authenticateToken,
    jwtSecret: JWT_SECRET,
  })
);

app.get("/api/admin/users", authenticateToken, async (req, res) => {
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

app.get("/api/admin/patients", authenticateToken, async (req, res) => {
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

app.get("/api/admin/archived", authenticateToken, async (req, res) => {
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

const PORT = process.env.PORT || 5000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ DentaSync server running on http://localhost:${PORT}`);
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
  });
}

module.exports = app;
