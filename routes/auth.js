const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { rateLimit } = require("express-rate-limit");
const {
  OtpDeliveryError,
  isOtpRequestId,
  normalizeOtp,
} = require("../services/otpService");

const RESETTABLE_ROLES = ["admin", "dentist", "staff", "patient"];
const INACTIVE_ACCOUNT_STATUSES = ["inactive", "disabled", "suspended"];

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
    status: (user.status || "active").toLowerCase(),
    isVerified: user.is_verified,
  };
};

function normalizeEmail(value) {
  if (typeof value !== "string") {
    return null;
  }

  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function normalizePhone(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const digits = String(value).replace(/\D/g, "");
  if (!digits) {
    return null;
  }

  // DentaSync's existing records use Philippine phone numbers. Canonicalizing
  // the local and E.164 forms avoids a registration/resend format mismatch.
  if (/^0\d{10}$/.test(digits)) {
    return `63${digits.slice(1)}`;
  }

  return digits;
}

function createAuthRouter({
  db,
  otpService,
  passwordResetService,
  authenticateToken,
  jwtSecret,
}) {
  const router = express.Router();
  const forgotPasswordRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      message: "Too many password reset requests. Please wait 15 minutes and try again.",
    },
  });

  async function recordLoginActivity(user, req, eventType) {
    if (typeof db.query !== "function") {
      return;
    }

    try {
      await db.query(
        `INSERT INTO patient_portal_login_activity (
           user_id, event_type, ip_address, user_agent
         ) VALUES ($1, $2, $3, $4)`,
        [
          String(user.id),
          eventType,
          req.ip || req.socket?.remoteAddress || null,
          req.get("user-agent") || null,
        ]
      );
    } catch (error) {
      // The portal migration may not yet be installed during a rolling deploy.
      if (error.code !== "42P01") {
        console.warn("Unable to record login activity:", error.message);
      }
    }
  }

  // --- 1. PATIENT REGISTRATION AND FIRST OTP ---
  router.post("/register", async (req, res) => {
    const { firstName, lastName, fullName, email, phone, password, role } = req.body;
    const normalizedEmail = normalizeEmail(email);
    const normalizedPhone = normalizePhone(phone);
    const requestedRole = (role || "patient").toLowerCase();

    if (!normalizedEmail || !normalizedPhone || !password) {
      return res.status(400).json({
        message: "Email, phone number, and password are required.",
      });
    }

    if (requestedRole !== "patient") {
      return res.status(403).json({
        message: "Self-registration is available only for patient accounts.",
      });
    }

    const computedFirstName = firstName || (fullName ? fullName.split(" ")[0] : "");
    const computedLastName =
      lastName || (fullName ? fullName.split(" ").slice(1).join(" ") : "");
    try {
      const existingUser = await db.query(
        "SELECT id FROM users WHERE LOWER(email) = $1 OR phone = $2",
        [normalizedEmail, normalizedPhone]
      );

      if (existingUser.rows.length > 0) {
        return res.status(409).json({
          message: "Email or mobile number is already registered.",
        });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const userResult = await db.query(
        `INSERT INTO users
           (first_name, last_name, email, phone, password_hash, role, is_verified, status)
         VALUES ($1, $2, $3, $4, $5, 'patient', FALSE, 'Active')
         RETURNING id, first_name, last_name, email, phone, role, status, is_verified`,
        [
          computedFirstName,
          computedLastName,
          normalizedEmail,
          normalizedPhone,
          hashedPassword,
        ]
      );

      try {
        const request = await otpService.issueOtp(userResult.rows[0]);
        return res.status(201).json({
          message: "Registration started. A verification code was sent to your email.",
          requiresOtp: true,
          requestId: request.requestId,
          expiresAt: request.expiresAt,
        });
      } catch (error) {
        if (error instanceof OtpDeliveryError) {
          return res.status(503).json({
            message:
              "Your account was created, but the verification code could not be delivered. Please request a new code.",
            requiresOtp: true,
            resendAvailable: true,
          });
        }
        throw error;
      }
    } catch (error) {
      if (error.code === "OTP_ACCOUNT_ALREADY_VERIFIED") {
        return res.status(409).json({ message: "This patient account is already verified." });
      }

      console.error("Patient registration error:", error.message);
      return res.status(500).json({ message: "Server error during registration." });
    }
  });

  // --- 2. RESEND OTP FOR THE SAME UNVERIFIED PATIENT ---
  router.post("/send-otp", async (req, res) => {
    const normalizedEmail = normalizeEmail(req.body?.email);
    const normalizedPhone = normalizePhone(req.body?.phone);

    if (!normalizedEmail || !normalizedPhone) {
      return res.status(400).json({
        message: "Email and phone number are required to resend a verification code.",
      });
    }

    try {
      const userResult = await db.query(
        `SELECT id, first_name, last_name, email, phone, role, status, is_verified
         FROM users
         WHERE LOWER(email) = $1 AND role = 'patient'
         LIMIT 1`,
        [normalizedEmail]
      );

      const user = userResult.rows[0];
      if (!user || normalizePhone(user.phone) !== normalizedPhone) {
        return res.status(404).json({
          message: "No matching patient verification request was found.",
        });
      }

      if (user.is_verified) {
        return res.status(409).json({ message: "This patient account is already verified." });
      }

      const request = await otpService.issueOtp(user);
      return res.status(200).json({
        message: "A new verification code was sent to your email.",
        requestId: request.requestId,
        expiresAt: request.expiresAt,
      });
    } catch (error) {
      if (error instanceof OtpDeliveryError) {
        return res.status(503).json({
          message: "The verification code could not be delivered. Please try again.",
        });
      }

      if (error.code === "OTP_ACCOUNT_ALREADY_VERIFIED") {
        return res.status(409).json({ message: "This patient account is already verified." });
      }

      console.error("OTP resend error:", error.message);
      return res.status(500).json({ message: "Unable to send a verification code." });
    }
  });

  // --- 3. VERIFY THE CURRENT OTP REQUEST ---
  router.post("/verify-otp", async (req, res) => {
    const { requestId: submittedRequestId, phone, otp } = req.body || {};

    if (!normalizeOtp(otp)) {
      return res.status(400).json({
        message: "OTP must be sent as a six-digit string.",
      });
    }

    try {
      let requestId = submittedRequestId;

      if (requestId === undefined || requestId === null || requestId === "") {
        // Existing clients sent { phone, otp }. Resolve only the newest active
        // request for that normalized phone, then use the same atomic verifier.
        const normalizedPhone = normalizePhone(phone);
        if (!normalizedPhone) {
          return res.status(400).json({
            message: "A valid OTP request ID or phone number is required.",
          });
        }

        requestId = await otpService.findActiveRequestIdByPhone(normalizedPhone);
        if (!isOtpRequestId(requestId)) {
          return res.status(400).json({ message: "Invalid or expired OTP code." });
        }
      } else if (!isOtpRequestId(requestId)) {
        return res.status(400).json({
          message: "A valid OTP request ID is required.",
        });
      }

      const result = await otpService.verifyOtp({ requestId, otp });
      if (result.status !== "verified") {
        return res.status(400).json({ message: "Invalid or expired OTP code." });
      }

      const token = jwt.sign(
        { id: result.user.id, role: result.user.role },
        jwtSecret,
        { expiresIn: "8h" }
      );
      await recordLoginActivity(result.user, req, "otp_verified");

      return res.status(200).json({
        message: "Account verified successfully!",
        token,
        user: formatUserPayload(result.user),
        redirectTo: "/patient/dashboard",
      });
    } catch (error) {
      console.error("OTP verification error:", error.message);
      return res.status(500).json({ message: "Server error during OTP verification." });
    }
  });

  // --- 4. PATIENT LOGIN ---
  router.post("/login", async (req, res) => {
    const { identifier, email, password } = req.body;
    const rawIdentifier = String(identifier || email || "").trim();
    const loginInput = rawIdentifier.includes("@")
      ? normalizeEmail(rawIdentifier)
      : normalizePhone(rawIdentifier);

    if (!loginInput || !password) {
      return res.status(400).json({ message: "Email/phone and password are required." });
    }

    try {
      const userResult = await db.query(
        "SELECT * FROM users WHERE LOWER(email) = $1 OR phone = $1 OR phone = $2",
        [loginInput, rawIdentifier]
      );

      if (userResult.rows.length === 0) {
        return res.status(401).json({ message: "Invalid credentials." });
      }

      const user = userResult.rows[0];
      const isPasswordMatch = await bcrypt.compare(password, user.password_hash);
      if (!isPasswordMatch) {
        return res.status(401).json({ message: "Invalid credentials." });
      }

      if (!user.is_verified) {
        return res.status(403).json({
          message: "Account unverified. Please complete OTP verification first.",
          requiresOtp: true,
          email: user.email,
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
        jwtSecret,
        { expiresIn: "8h" }
      );
      await recordLoginActivity(user, req, "login");

      const normalizedRole = String(user.role || "").toLowerCase();
      const redirectTo =
        normalizedRole === "staff"
          ? "/staff/check-ins"
          : normalizedRole === "patient"
            ? "/dashboard"
            : "/access-denied";

      return res.status(200).json({
        message: "Login successful!",
        token,
        user: formatUserPayload(user),
        redirectTo,
      });
    } catch (error) {
      console.error("Login error:", error.message);
      return res.status(500).json({ message: "Server error during authentication." });
    }
  });

  // --- 5. REQUEST A PASSWORD RESET ---
  router.post("/forgot-password", forgotPasswordRateLimiter, async (req, res) => {
    const acceptedResponse = {
      message:
        "If a verified Amethyst Dental account matches that email, a password reset link will arrive shortly.",
    };
    const normalizedEmail = normalizeEmail(req.body?.email);

    if (!passwordResetService) {
      return res.status(503).json({
        message: "Password reset is temporarily unavailable. Please contact the clinic.",
      });
    }

    if (!normalizedEmail) {
      return res.status(400).json({
        message: "Please enter a valid email address.",
      });
    }

    try {
      const userResult = await db.query(
        `SELECT id, first_name, last_name, email, phone, role, status, is_verified
         FROM users
         WHERE LOWER(email) = $1
           AND LOWER(role) = ANY($2::text[])
           AND is_verified = TRUE
           AND COALESCE(is_archived, FALSE) = FALSE
           AND LOWER(COALESCE(status, 'active')) <> ALL($3::text[])
         LIMIT 1`,
        [normalizedEmail, RESETTABLE_ROLES, INACTIVE_ACCOUNT_STATUSES]
      );
      const user = userResult.rows[0];

      if (!user) {
        return res.status(404).json({
          message: "Email address not found. Please check your email and try again.",
        });
      }

      try {
        await passwordResetService.issuePasswordReset(user);
      } catch (error) {
        console.error("Password reset email delivery failed:", error.message);
        return res.status(503).json({
          message: "Unable to send the reset email. Please try again later.",
        });
      }

      return res.status(202).json(acceptedResponse);
    } catch (error) {
      console.error("Password reset request error:", error.message);
      return res.status(503).json({
        message: "Password reset is temporarily unavailable. Please try again later.",
      });
    }
  });

  // --- 6. COMPLETE A PASSWORD RESET ---
  router.post("/reset-password", async (req, res) => {
    const { token, newPassword, password } = req.body || {};
    const submittedPassword = newPassword || password;

    if (!passwordResetService) {
      return res.status(503).json({
        message: "Password reset is temporarily unavailable. Please contact the clinic.",
      });
    }
    if (typeof submittedPassword !== "string" || submittedPassword.length < 10) {
      return res.status(400).json({
        message: "Choose a new password of at least 10 characters.",
      });
    }

    try {
      const passwordHash = await bcrypt.hash(submittedPassword, 12);
      const result = await passwordResetService.resetPassword({
        token,
        passwordHash,
      });
      if (result.status !== "reset") {
        return res.status(400).json({
          message: "This password reset link is invalid or expired. Request a new link.",
        });
      }

      await recordLoginActivity(result.user, req, "password_reset");
      return res.status(200).json({
        message: "Your password has been reset. You can now sign in.",
      });
    } catch (error) {
      console.error("Password reset completion error:", error.message);
      return res.status(500).json({
        message: "Unable to reset your password. Please request a new link.",
      });
    }
  });

  // --- 7. GET CURRENT USER (SESSION HYDRATION) ---
  router.get("/me", authenticateToken, async (req, res) => {
    try {
      const userResult = await db.query("SELECT * FROM users WHERE id = $1", [req.user.id]);

      if (userResult.rows.length === 0) {
        return res.status(404).json({ message: "User account no longer exists." });
      }

      return res.status(200).json({
        user: formatUserPayload(userResult.rows[0]),
      });
    } catch (error) {
      console.error("Auth /me error:", error.message);
      return res.status(500).json({ message: "Server error retrieving profile." });
    }
  });

  return router;
}

module.exports = {
  createAuthRouter,
  formatUserPayload,
  normalizeEmail,
  normalizePhone,
};