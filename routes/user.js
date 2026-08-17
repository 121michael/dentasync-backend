const express = require("express");
const router = express.Router();
const db = require("../db");
const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");

// --- GET ALL USERS (Admin Only) ---
router.get("/", authenticateToken, authorizeRoles("admin"), async (req, res) => {
  try {
    // Exclude passwords from the payload
    const result = await db.query(
      `SELECT id, email, first_name, last_name, role, status, created_at FROM users ORDER BY id ASC`
    );
    
    // Map data to match frontend expectations
    const formattedUsers = result.rows.map(u => ({
      id: u.id,
      email: u.email,
      name: `${u.first_name} ${u.last_name}`.trim(),
      role: u.role,
      status: u.status,
      created_at: u.created_at
    }));

    res.status(200).json(formattedUsers);
  } catch (error) {
    console.error("Fetch Users Error:", error);
    res.status(500).json({ message: "Failed to fetch users." });
  }
});

// --- UPDATE USER ROLE (Admin Only) ---
router.patch("/:id/role", authenticateToken, authorizeRoles("admin"), async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  const validRoles = ["patient", "dentist", "staff", "admin"];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ message: "Invalid role specified." });
  }

  try {
    const result = await db.query(
      `UPDATE users SET role = $1 WHERE id = $2 RETURNING id, email, role`,
      [role, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found." });
    }

    res.status(200).json({ message: "Role updated successfully", user: result.rows[0] });
  } catch (error) {
    console.error("Update Role Error:", error);
    res.status(500).json({ message: "Failed to update role." });
  }
});

module.exports = router;