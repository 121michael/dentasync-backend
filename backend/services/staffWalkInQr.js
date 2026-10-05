"use strict";

const crypto = require("crypto");
const QRCode = require("qrcode");

const DEFAULT_TTL_SECONDS = Number(process.env.WALKIN_QR_TTL_SECONDS || 10 * 60);

function frontendBaseUrl() {
  return String(process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
}

function buildCheckInUrl(token) {
  return `${frontendBaseUrl()}/walk-in-check-in?token=${encodeURIComponent(token)}`;
}

function isMissingRelation(error) {
  return error?.code === "42P01";
}

async function createWalkInQrSession(db, { staffId, ttlSeconds = DEFAULT_TTL_SECONDS }) {
  const token = crypto.randomBytes(24).toString("hex");
  const ttl = Math.max(60, Number(ttlSeconds) || DEFAULT_TTL_SECONDS);
  const result = await db.query(
    `INSERT INTO staff_walkin_qr_sessions (token, created_by_user_id, expires_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP + ($3::text || ' seconds')::interval)
     RETURNING id, token, expires_at, created_at`,
    [token, String(staffId), String(ttl)]
  );
  const session = result.rows[0];
  const checkInUrl = buildCheckInUrl(session.token);
  const qrDataUrl = await QRCode.toDataURL(checkInUrl, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 360,
    color: { dark: "#32134f", light: "#ffffff" },
  });

  return {
    id: session.id,
    token: session.token,
    expiresAt: session.expires_at,
    createdAt: session.created_at,
    ttlSeconds: ttl,
    checkInUrl,
    qrDataUrl,
  };
}

async function getActiveWalkInQrSession(db, { staffId } = {}) {
  const result = await db.query(
    `SELECT id, token, created_by_user_id, expires_at, created_at
     FROM staff_walkin_qr_sessions
     WHERE revoked_at IS NULL
       AND expires_at > CURRENT_TIMESTAMP
       ${staffId ? "AND created_by_user_id = $1" : ""}
     ORDER BY created_at DESC
     LIMIT 1`,
    staffId ? [String(staffId)] : []
  );
  const session = result.rows[0];
  if (!session) return null;

  const checkInUrl = buildCheckInUrl(session.token);
  const qrDataUrl = await QRCode.toDataURL(checkInUrl, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 360,
    color: { dark: "#32134f", light: "#ffffff" },
  });

  return {
    id: session.id,
    token: session.token,
    expiresAt: session.expires_at,
    createdAt: session.created_at,
    checkInUrl,
    qrDataUrl,
  };
}

async function revokeWalkInQrSession(db, { sessionId, staffId }) {
  const result = await db.query(
    `UPDATE staff_walkin_qr_sessions
     SET revoked_at = CURRENT_TIMESTAMP
     WHERE id = $1
       AND created_by_user_id = $2
       AND revoked_at IS NULL
     RETURNING id`,
    [sessionId, String(staffId)]
  );
  return Boolean(result.rows[0]);
}

async function findValidWalkInQrSession(db, token) {
  const normalized = typeof token === "string" ? token.trim() : "";
  if (!normalized || normalized.length < 16) {
    return { status: "invalid", session: null };
  }

  const result = await db.query(
    `SELECT id, token, expires_at, revoked_at, created_at
     FROM staff_walkin_qr_sessions
     WHERE token = $1
     LIMIT 1`,
    [normalized]
  );
  const session = result.rows[0];
  if (!session) return { status: "invalid", session: null };
  if (session.revoked_at) return { status: "revoked", session };
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    return { status: "expired", session };
  }
  return { status: "valid", session };
}

module.exports = {
  DEFAULT_TTL_SECONDS,
  isMissingRelation,
  createWalkInQrSession,
  getActiveWalkInQrSession,
  revokeWalkInQrSession,
  findValidWalkInQrSession,
  buildCheckInUrl,
};
