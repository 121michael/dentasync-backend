require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const twilio = require("twilio");
const db = require("./db");

const app = express();

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

  jwt.verify(token, process.env.JWT_SECRET || "your_super_secret_key_here", (err, user) => {
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

async function sendEmailOtp(toEmail, otpCode) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log("⚠️ Email credentials missing in .env. Skipping real email dispatch.");
    return;
  }
  const mailOptions = {
    from: `"DentaSync Care" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: "Your DentaSync Verification Code",
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
        <h2>Welcome to DentaSync!</h2>
        <p>Your 6-digit verification code is:</p>
        <h1 style="color: #4F46E5; letter-spacing: 5px;">${otpCode}</h1>
        <p>This code will expire in 5 minutes.</p>
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
// TEMPORARY SEED ROUTE (Creates or resets default test users)
// ==========================================
app.get("/api/auth/seed-users", async (req, res) => {
  try {
    const hashedPassword = await bcrypt.hash('password123', 10);

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
      users: result.rows
    });

  } catch (error) {
    console.error('Seeding error:', error);
    res.status(500).json({ message: 'Failed to seed users', error: error.message });
  }
});

// ==========================================
// 2. AUTHENTICATION & USER MANAGEMENT
// ==========================================

// --- SEND SIGNUP OTP TO GMAIL ---
app.post("/api/auth/send-otp", async (req, res) => {
  const { email, phone } = req.body;

  if (!email || !phone) {
    return res.status(400).json({ message: "Email and Phone number are required." });
  }

  try {
    // Generate random 6-digit OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Set expiration to 5 minutes from now
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // Save OTP into your database 'otps' table
    await db.query(
      `INSERT INTO otps (phone, otp_code, expires_at) 
       VALUES ($1, $2, $3)`,
      [phone, otpCode, expiresAt]
    );

    // Trigger your existing sendEmailOtp function
    await sendEmailOtp(email, otpCode);

    console.log(`✅ OTP sent successfully to Gmail: ${email}`);

    res.status(200).json({ 
      message: `Verification code sent to ${email}`,
      email: email,
      phone: phone
    });

  } catch (error) {
    console.error("❌ Send OTP Error:", error);
    res.status(500).json({ message: "Failed to send OTP code to Gmail.", error: error.message });
  }
});

// --- REGISTER (Auto-Login Instant Patient Access) ---
app.post("/api/auth/register", async (req, res) => {
  const { firstName, lastName, email, phone, password, role } = req.body;
  try {
    const userCheck = await db.query("SELECT id FROM users WHERE email = $1 OR phone = $2", [email, phone]);
    if (userCheck.rows.length > 0) return res.status(400).json({ message: "Email or Mobile Number is already registered." });

    const hashedPassword = await bcrypt.hash(password, 10);

    // Creates user as verified for immediate login
    const newUserResult = await db.query(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status) 
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, 'Active')
       RETURNING id, first_name, last_name, email, phone, role`,
      [firstName, lastName, email, phone, hashedPassword, role || "patient"]
    );

    const user = newUserResult.rows[0];

    // Generate JWT Token for immediate session authentication
    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET || "your_super_secret_key_here",
      { expiresIn: "8h" }
    );

    res.status(201).json({
      message: "Registration successful!",
      token,
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        name: `${user.first_name} ${user.last_name}`,
        email: user.email,
        phone: user.phone,
        role: user.role
      }
    });

  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ message: "Registration failed", error: error.message });
  }
});

// --- VERIFY OTP ---
app.post("/api/auth/verify-otp", async (req, res) => {
  const { phone, otp } = req.body;
  try {
    const otpResult = await db.query(
      "SELECT * FROM otps WHERE phone = $1 AND otp_code = $2 AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1",
      [phone, otp]
    );

    if (otpResult.rows.length === 0) return res.status(400).json({ message: "Invalid or expired OTP code." });

    const userResult = await db.query(
      "UPDATE users SET is_verified = TRUE WHERE phone = $1 RETURNING id, first_name, last_name, email, phone, role",
      [phone]
    );

    await db.query("DELETE FROM otps WHERE phone = $1", [phone]);
    const user = userResult.rows[0];

    res.status(200).json({
      message: "Account verified successfully!",
      user: { id: user.id, firstName: user.first_name, lastName: user.last_name, name: `${user.first_name} ${user.last_name}`, email: user.email, phone: user.phone, role: user.role }
    });
  } catch (error) {
    res.status(500).json({ message: "OTP verification failed", error: error.message });
  }
});

// --- DIRECT LOGIN ---
app.post("/api/auth/login", async (req, res) => {
  const { identifier, password } = req.body;
  try {
    const userResult = await db.query("SELECT * FROM users WHERE email = $1 OR phone = $1", [identifier]);
    if (userResult.rows.length === 0) return res.status(400).json({ message: "User not found." });

    const user = userResult.rows[0];
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) return res.status(400).json({ message: "Invalid credentials." });
    if (!user.is_verified) return res.status(403).json({ message: "Please complete OTP verification first." });
    
    if (user.status === "Disabled" || user.status === "Inactive") {
      return res.status(403).json({ message: "Account disabled by administrator." });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET || "your_super_secret_key_here",
      { expiresIn: "8h" }
    );

    res.status(200).json({
      message: "Login successful!",
      token,
      user: { id: user.id, firstName: user.first_name, lastName: user.last_name, name: `${user.first_name} ${user.last_name}`, email: user.email, phone: user.phone, role: user.role }
    });
  } catch (error) {
    res.status(500).json({ message: "Login failed", error: error.message });
  }
});

// --- GET CURRENT USER ---
app.get("/api/auth/me", authenticateToken, async (req, res) => {
  try {
    const userResult = await db.query("SELECT id, first_name, last_name, email, phone, role, status FROM users WHERE id = $1", [req.user.id]);
    if (userResult.rows.length === 0) return res.status(404).json({ message: "User not found." });
    
    const user = userResult.rows[0];
    res.status(200).json({
      user: { id: user.id, firstName: user.first_name, lastName: user.last_name, name: `${user.first_name} ${user.last_name}`, email: user.email, phone: user.phone, role: user.role, status: user.status }
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch profile." });
  }
});

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
app.listen(PORT, () => {
  console.log(`✅ DentaSync server running on http://localhost:${PORT}`);
});