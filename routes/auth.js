const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("../db");
const { authenticateToken } = require("../middleware/authMiddleware");
const nodemailer = require("nodemailer");
const { normalizePhone, normalizeOtp, phoneMatchVariants } = require("../utils/otp");

// --- NODEMAILER SETUP ---
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Helper function to format consistent user responses across all endpoints
const formatUserPayload = (user) => {
  const firstName = user.first_name || (user.full_name ? user.full_name.split(" ")[0] : "");
  const lastName = user.last_name || (user.full_name ? user.full_name.split(" ").slice(1).join(" ") : "");
  const fullName = user.full_name || `${firstName} ${lastName}`.trim();

  return {
    id: user.id,
    firstName,
    lastName,
    fullName,
    email: user.email,
    phone: user.phone || null,
    role: user.role,
    status: user.status.toLowerCase(),
    isVerified: user.is_verified,
  };
};

// --- 1.  NEW USER ---
router.post("/register", async (req, res) => {
  const { firstName, lastName, fullName, email, phone, password, role } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required." });
  }

  // 🐛 DEBUG LOG 1
  console.log(`📩 Received registration request for: ${email}`);

  const computedFirstName = firstName || (fullName ? fullName.split(" ")[0] : "");
  const computedLastName = lastName || (fullName ? fullName.split(" ").slice(1).join(" ") : "");
  const computedFullName = fullName || `${computedFirstName} ${computedLastName}`.trim();
  const normalizedEmail = email.toLowerCase().trim();
  const normalizedPhone = normalizePhone(phone);
  const assignedRole = (role || "patient").toLowerCase();

  try {
    // Check duplicate email or phone
    const existingUser = await db.query(
      "SELECT id FROM users WHERE LOWER(email) = $1 OR (phone = $2 AND phone IS NOT NULL AND $2 != '')",
      [normalizedEmail, normalizedPhone || ""]
    );

    if (existingUser.rows.length > 0) {
      console.log(`🚧 Duplicate account found for: ${normalizedEmail}. Email logic skipped.`);
      return res.status(409).json({ message: "Email or mobile number is already registered." });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Save user record
    const isVerified = assignedRole !== "patient";
    const initialStatus = "active";

    await db.query(
      `INSERT INTO users (first_name, last_name, full_name, email, phone, password_hash, role, is_verified, status) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        computedFirstName,
        computedLastName,
        computedFullName,
        normalizedEmail,
        normalizedPhone || null,
        hashedPassword,
        assignedRole,
        isVerified,
        initialStatus,
      ]
    );

    // 🐛 DEBUG LOG 2 - Very critical!
    console.log(`🔍 Checking conditions: Role=[${assignedRole}], Phone=[${normalizedPhone}]`);

    // --- REAL OTP GENERATION & EMAIL SENDING ---
    if (assignedRole === "patient" && normalizedPhone) {
      
      // 🐛 DEBUG LOG 3
      console.log(`🔥 Conditions met. Initiating email send to: ${normalizedEmail}`);

      // Generate a random 6-digit number
      const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();

      // Use DB clock for expiry so Node/Postgres timezone skew cannot invalidate valid OTPs
      await db.query(
        "INSERT INTO otps (phone, otp_code, expires_at) VALUES ($1, $2, NOW() + INTERVAL '5 minutes')",
        [normalizedPhone, generatedOtp]
      );

      // Send to Gmail
      try {
        await transporter.sendMail({
          from: `"Amethyst Dental" <${process.env.EMAIL_USER}>`,
          to: normalizedEmail,
          subject: "Your Amethyst Registration OTP",
          html: `
            <div style="font-family: Arial, sans-serif; padding: 20px;">
              <h2>Welcome to Amethyst Dental Clinic!</h2>
              <p>Your 6-digit registration code is:</p>
              <h1 style="color: #6b21a8; letter-spacing: 5px;">${generatedOtp}</h1>
            </div>
          `,
        });
        console.log(`✅ OTP Email sent successfully to ${normalizedEmail}`);
      } catch (emailErr) {
        console.error("❌ Failed to send email:", emailErr);
      }

      return res.status(201).json({
        message: "Registration initiated. Verification OTP sent to email.",
        requiresOtp: true,
      });
    }

    // 🐛 DEBUG LOG 4
    console.log(`⚠️ Email conditions NOT met. RequiresOtp set to false.`);

    res.status(201).json({
      message: "Account created successfully. You can now log in.",
      requiresOtp: false,
    });
  } catch (err) {
    console.error("❌ General Registration Error:", err);
    res.status(500).json({ message: "Server error during account registration." });
  }
});

// --- 2. VERIFY REGISTRATION OTP ---
router.post("/verify-otp", async (req, res) => {
  const { phone, otp, otpCode, code } = req.body;
  const normalizedPhone = normalizePhone(phone);
  const normalizedOtp = normalizeOtp(otp ?? otpCode ?? code);

  if (!normalizedPhone || !normalizedOtp) {
    return res.status(400).json({ message: "Phone number and OTP code are required." });
  }

  try {
    const phoneVariants = phoneMatchVariants(normalizedPhone);

    // Compare as text and match phone by digits so formatting differences do not fail valid codes
    const otpResult = await db.query(
      `SELECT * FROM otps
       WHERE regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = ANY($1::text[])
         AND TRIM(otp_code::text) = $2
         AND expires_at > NOW()
       ORDER BY expires_at DESC
       LIMIT 1`,
      [phoneVariants, normalizedOtp]
    );

    if (otpResult.rows.length === 0) {
      return res.status(400).json({ message: "Invalid or expired OTP code." });
    }

    const userResult = await db.query(
      `UPDATE users
       SET is_verified = TRUE, updated_at = CURRENT_TIMESTAMP, phone = $2
       WHERE regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = ANY($1::text[])
          OR phone = $2
       RETURNING *`,
      [phoneVariants, normalizedPhone]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "Associated user account not found." });
    }

    await db.query(
      `DELETE FROM otps
       WHERE regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = ANY($1::text[])
          OR phone = $2`,
      [phoneVariants, normalizedPhone]
    );

    const user = userResult.rows[0];
    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET || "dentasync_default_capstone_jwt_secret",
      { expiresIn: "8h" }
    );

    res.status(200).json({
      message: "Email verified successfully!",
      token,
      user: formatUserPayload(user),
    });
  } catch (err) {
    console.error("OTP Verification Error:", err);
    res.status(500).json({ message: "Server error during OTP verification." });
  }
});

// --- 3. UNIFIED LOGIN (Role Inferred from Database) ---
router.post("/login", async (req, res) => {
  const { identifier, email, password } = req.body;
  const rawLogin = (identifier || email || "").trim();
  const loginInput = rawLogin.toLowerCase();
  const phoneLogin = normalizePhone(rawLogin);
  const rawPassword = password;

  if (!loginInput || !rawPassword) {
    return res.status(400).json({ message: "Email/Phone and password are required." });
  }

  try {
    const userResult = await db.query(
      `SELECT * FROM users
       WHERE LOWER(email) = $1
          OR (phone IS NOT NULL AND (
                phone = $1
             OR phone = $2
             OR regexp_replace(phone, '\\D', '', 'g') = $2
          ))`,
      [loginInput, phoneLogin || loginInput]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ message: "Invalid credentials." });
    }

    const user = userResult.rows[0];

    const isPasswordMatch = await bcrypt.compare(rawPassword, user.password_hash);
    if (!isPasswordMatch) {
      return res.status(401).json({ message: "Invalid credentials." });
    }

    if (!user.is_verified) {
      return res.status(403).json({
        message: "Account unverified. Please complete OTP verification first.",
        requiresOtp: true,
        phone: user.phone,
      });
    }

    const currentStatus = (user.status || "active").toLowerCase();
    if (["inactive", "disabled", "suspended"].includes(currentStatus)) {
      return res.status(403).json({
        message: `Account is ${currentStatus}. Please contact the administrator.`,
      });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET || "dentasync_default_capstone_jwt_secret",
      { expiresIn: "8h" }
    );

    res.status(200).json({
      message: "Login successful!",
      token,
      user: formatUserPayload(user),
    });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ message: "Server error during authentication." });
  }
});

// --- 4. GET CURRENT USER (Session Hydration) ---
router.get("/me", authenticateToken, async (req, res) => {
  try {
    const userResult = await db.query(
      "SELECT * FROM users WHERE id = $1",
      [req.user.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "User account no longer exists." });
    }

    const user = userResult.rows[0];
    res.status(200).json({
      user: formatUserPayload(user),
    });
  } catch (err) {
    console.error("Auth /me Error:", err);
    res.status(500).json({ message: "Server error retrieving profile." });
  }
});

module.exports = router;