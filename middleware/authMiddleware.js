const jwt = require('jsonwebtoken');
const pool = require('../db'); // Your PostgreSQL pg pool instance
const { resolveAppSecrets } = require('../lib/securityConfig');

const { jwtSecret: JWT_SECRET } = resolveAppSecrets(process.env);

// Verify JWT Token & Load Authenticated User
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Access token required.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Fetch live user status directly from DB using first_name and last_name
    const userQuery = await pool.query(
      'SELECT id, first_name, last_name, email, role, status FROM users WHERE id = $1',
      [decoded.id]
    );

    if (userQuery.rows.length === 0) {
      return res.status(401).json({ message: 'User account no longer exists.' });
    }

    const user = userQuery.rows[0];

    if (user.status !== 'active') {
      return res.status(403).json({ 
        message: 'Your account has been disabled or suspended. Please contact the administrator.' 
      });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(403).json({ message: 'Invalid or expired token.' });
  }
};

// Role-Based Authorization Guard
const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        message: 'Forbidden: You do not have permission to perform this action.' 
      });
    }
    next();
  };
};

module.exports = { authenticateToken, authorizeRoles, JWT_SECRET };
