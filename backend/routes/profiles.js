const express = require("express");
const router = express.Router();
const db = require("../db");
const { authenticateToken } = require("../middleware/authMiddleware");

// --- 1. GET CURRENT USER'S PROFILE ---
router.get("/me", authenticateToken, async (req, res) => {
  const { id: userId, role } = req.user;

  try {
    let query = "";
    
    // Fetch profile data based on their role
    if (role === "patient") {
      query = `SELECT * FROM patients WHERE user_id = $1`;
    } else if (role === "dentist") {
      query = `SELECT * FROM dentists WHERE user_id = $1`;
    } else if (role === "staff" || role === "admin") {
      query = `SELECT * FROM staff WHERE user_id = $1`;
    } else {
      return res.status(400).json({ message: "Invalid user role." });
    }

    const result = await db.query(query, [userId]);

    if (result.rows.length === 0) {
      // If the profile doesn't exist yet, return an empty object 
      // so the frontend knows to prompt the user to complete their profile.
      return res.status(200).json({ profile: null, message: "Profile incomplete." });
    }

    res.status(200).json({ profile: result.rows[0] });
  } catch (error) {
    console.error("Fetch Profile Error:", error);
    res.status(500).json({ message: "Failed to fetch profile data." });
  }
});

// --- 2. UPDATE OR CREATE PATIENT PROFILE ---
router.post("/patient", authenticateToken, async (req, res) => {
  const { id: userId, role } = req.user;
  const { dateOfBirth, gender, address, emergencyContactName, emergencyContactPhone } = req.body;

  if (role !== "patient") {
    return res.status(403).json({ message: "Only patients can update patient profiles." });
  }

  try {
    // Check if profile exists
    const checkRes = await db.query("SELECT id FROM patients WHERE user_id = $1", [userId]);
    
    let result;
    if (checkRes.rows.length > 0) {
      // Update existing
      result = await db.query(
        `UPDATE patients 
         SET date_of_birth = $1, gender = $2, address = $3, emergency_contact_name = $4, emergency_contact_phone = $5, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $6 RETURNING *`,
        [dateOfBirth, gender, address, emergencyContactName, emergencyContactPhone, userId]
      );
    } else {
      // Insert new
      result = await db.query(
        `INSERT INTO patients (user_id, date_of_birth, gender, address, emergency_contact_name, emergency_contact_phone)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [userId, dateOfBirth, gender, address, emergencyContactName, emergencyContactPhone]
      );
    }

    res.status(200).json({ message: "Profile updated successfully.", profile: result.rows[0] });
  } catch (error) {
    console.error("Update Profile Error:", error);
    res.status(500).json({ message: "Failed to update profile." });
  }
});

module.exports = router;