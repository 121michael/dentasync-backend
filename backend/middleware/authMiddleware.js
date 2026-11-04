const jwt = require('jsonwebtoken');
const pool = require('../db'); // Your PostgreSQL pg pool instance
const { resolveAppSecrets } = require('../lib/securityConfig');
const {
  isMissingPasswordChangedAtColumn,
  isTokenRevokedByPasswordChange,
  schemaPasswordChangedAtError,
} = require('../services/sessionRevocation');

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

async function loadActiveUser(userId, database = pool) {
  const id = String(userId);
  const statements = [
    `SELECT id, first_name, last_name, email, phone, role, status, password_changed_at
       FROM users
       WHERE id::text = $1
         AND COALESCE(is_archived, FALSE) = FALSE
       LIMIT 1`,
    `SELECT id, first_name, last_name, email, phone, role, status, password_changed_at
       FROM users
       WHERE id::text = $1
       LIMIT 1`,
  ];
  let lastError = null;
  for (const sql of statements) {
    try {
      const userQuery = await database.query(sql, [id]);
      return userQuery.rows[0] || null;
    } catch (error) {
      if (isMissingPasswordChangedAtColumn(error)) {
        throw schemaPasswordChangedAtError();
      }
      if (error?.code !== '42703') {
        throw error;
      }
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return null;
}

async function guardianLinkedToDependent(guardianId, dependentId, database = pool) {
  const params = [String(guardianId), String(dependentId)];
  const statements = [
    `SELECT 1
     FROM patient_portal_dependents
     WHERE guardian_user_id::text = $1
       AND dependent_user_id::text = $2
       AND LOWER(COALESCE(approval_status, 'approved')) = 'approved'
       AND removed_at IS NULL
     LIMIT 1`,
    `SELECT 1
     FROM patient_portal_dependents
     WHERE guardian_user_id::text = $1
       AND dependent_user_id::text = $2
       AND LOWER(COALESCE(approval_status, 'approved')) = 'approved'
     LIMIT 1`,
  ];
  let lastError = null;
  for (const sql of statements) {
    try {
      const link = await database.query(sql, params);
      return link.rows.length > 0;
    } catch (error) {
      if (error?.code === '42P01') {
        return false;
      }
      if (error?.code !== '42703') {
        throw error;
      }
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return false;
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

    if (isTokenRevokedByPasswordChange(decoded, principal.password_changed_at)) {
      return res.status(401).json({ message: 'Session expired. Please sign in again.' });
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
      if (!linked) {
        return res.status(403).json({
          message: 'Guardian access to this dependent has been revoked. Switch back to your account.',
          code: 'ACT_AS_LINK_REVOKED',
        });
      }

      const dependent = await loadActiveUser(actAsUserId);
      const dependentOk =
        dependent &&
        String(dependent.role || '').toLowerCase() === 'patient' &&
        !isInactiveStatus(dependent.status);

      if (!dependentOk) {
        return res.status(403).json({
          message: 'Guardian access to this dependent has been revoked. Switch back to your account.',
          code: 'ACT_AS_LINK_REVOKED',
        });
      }

      req.user = mapAuthUser(dependent);
      req.actingAs = true;
      req.actAsUserId = actAsUserId;
    }

    next();
  } catch (error) {
    if (error?.name === 'JsonWebTokenError' || error?.name === 'TokenExpiredError' || error?.name === 'NotBeforeError') {
      return res.status(403).json({ message: 'Invalid or expired token.' });
    }
    if (error?.status === 503 || error?.code === 'SCHEMA_PASSWORD_CHANGED_AT') {
      return res.status(503).json({
        message: error.message || 'Session revocation schema is missing. Run npm run migrate:password-reset.',
        code: 'SCHEMA_PASSWORD_CHANGED_AT',
      });
    }
    console.error('Auth token validation error:', error.message);
    return res.status(500).json({ message: 'Unable to validate your session.' });
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

module.exports = {
  authenticateToken,
  authorizeRoles,
  guardianLinkedToDependent,
  loadActiveUser,
  JWT_SECRET,
};
