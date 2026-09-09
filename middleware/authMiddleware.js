const jwt = require('jsonwebtoken');
const pool = require('../db'); // Your PostgreSQL pg pool instance
const { resolveAppSecrets } = require('../lib/securityConfig');

const { jwtSecret: JWT_SECRET } = resolveAppSecrets(process.env);

function mapAuthUser(row) {
  return {
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    email: row.email,
    phone: row.phone || null,
    role: row.role,
    status: row.status,
  };
}

function isInactiveStatus(status) {
  return ['inactive', 'disabled', 'suspended', 'rejected'].includes(
    String(status || 'active').toLowerCase()
  );
}

async function loadActiveUser(userId) {
  const userQuery = await pool.query(
    `SELECT id, first_name, last_name, email, phone, role, status
     FROM users
     WHERE id = $1
       AND COALESCE(is_archived, FALSE) = FALSE
     LIMIT 1`,
    [userId]
  );
  return userQuery.rows[0] || null;
}

async function guardianLinkedToDependent(guardianId, dependentId) {
  try {
    const link = await pool.query(
      `SELECT 1
       FROM patient_portal_dependents
       WHERE guardian_user_id::text = $1
         AND dependent_user_id::text = $2
       LIMIT 1`,
      [String(guardianId), String(dependentId)]
    );
    return link.rows.length > 0;
  } catch (error) {
    if (error?.code === '42P01') {
      return false;
    }
    throw error;
  }
}

// Verify JWT Token & Load Authenticated User
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Access token required.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const principal = await loadActiveUser(decoded.id);

    if (!principal) {
      return res.status(401).json({ message: 'User account no longer exists.' });
    }

    if (isInactiveStatus(principal.status)) {
      return res.status(403).json({
        message: 'Your account has been disabled or suspended. Please contact the administrator.'
      });
    }

    req.authUser = mapAuthUser(principal);
    req.user = mapAuthUser(principal);
    req.actingAs = false;
    req.actAsUserId = null;

    const actAsUserId = decoded.actAsUserId ? String(decoded.actAsUserId) : null;
    if (actAsUserId) {
      if (String(principal.role || '').toLowerCase() !== 'patient') {
        // Ignore invalid act-as claims and continue as the authenticated principal.
        return next();
      }

      const linked = await guardianLinkedToDependent(principal.id, actAsUserId);
      const dependent = linked ? await loadActiveUser(actAsUserId) : null;
      const dependentOk =
        dependent &&
        String(dependent.role || '').toLowerCase() === 'patient' &&
        !isInactiveStatus(dependent.status);

      if (!dependentOk) {
        // Link removed or dependent unavailable — stay on principal account.
        req.actAsDropped = true;
        return next();
      }

      req.user = mapAuthUser(dependent);
      req.actingAs = true;
      req.actAsUserId = actAsUserId;
    }

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
