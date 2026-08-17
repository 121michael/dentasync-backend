const express = require("express");
const router = express.Router();
const db = require("../db");
const { authenticateToken } = require("../middleware/authMiddleware");

// --- GET APPOINTMENTS ---
router.get("/", authenticateToken, async (req, res) => {
  const { id: userId, role } = req.user;

  try {
    let query = "";
    let params = [];

    if (role === "patient") {
      // Patients only see their own appointments
      query = `SELECT * FROM appointments WHERE patient_id = $1 ORDER BY appointment_date ASC`;
      params = [userId];
    } else if (role === "dentist") {
      // Dentists see appointments assigned to them
      query = `SELECT * FROM appointments WHERE dentist_id = $1 ORDER BY appointment_date ASC`;
      params = [userId];
    } else {
      // Staff and Admins see all appointments
      query = `SELECT * FROM appointments ORDER BY appointment_date ASC`;
    }

    const result = await db.query(query, params);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Fetch Appointments Error:", error);
    res.status(500).json({ message: "Failed to fetch appointments." });
  }
});

// --- CREATE APPOINTMENT ---
router.post("/", authenticateToken, async (req, res) => {
  const { id: userId, role } = req.user;
  const { dentistId, serviceId, appointmentDate, appointmentTime, hmoUsed, notes } = req.body;

  if (role !== "patient") {
    return res.status(403).json({ message: "Only patients can book appointments here." });
  }

  try {
    const result = await db.query(
      `INSERT INTO appointments (patient_id, dentist_id, service_id, appointment_date, appointment_time, hmo_used, notes, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending') RETURNING *`,
      [userId, dentistId, serviceId, appointmentDate, appointmentTime, hmoUsed, notes]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Book Appointment Error:", error);
    res.status(500).json({ message: "Failed to book appointment." });
  }
});

// --- UPDATE APPOINTMENT STATUS ---
router.patch("/:id", authenticateToken, async (req, res) => {
  const { role } = req.user;
  const { id } = req.params;
  const { status } = req.body;

  // Only Staff, Admins, and Dentists should update statuses
  if (role === "patient") {
    return res.status(403).json({ message: "Patients cannot change appointment status directly." });
  }

  try {
    const result = await db.query(
      `UPDATE appointments SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Appointment not found." });
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("Update Status Error:", error);
    res.status(500).json({ message: "Failed to update status." });
  }
});

module.exports = router;