"use strict";

const crypto = require("crypto");

const OTP_REQUESTS_TABLE = "otp_verification_requests";
const MAX_FAILED_ATTEMPTS = 3;
const LOCKOUT_SECONDS = 5 * 60;

function hashesMatch(left, right) {
  if (typeof left !== "string" || typeof right !== "string") {
    return false;
  }

  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function isExpiredValue(value) {
  return value === true || value === "t";
}

function isValidTimestamp(value) {
  return !Number.isNaN(new Date(value).getTime());
}

async function rollbackIfNeeded(client, transactionOpen) {
  if (transactionOpen) {
    await client.query("ROLLBACK");
  }
}

function createPostgresOtpStore(pool) {
  if (!pool || typeof pool.connect !== "function") {
    throw new Error("A PostgreSQL connection pool is required for OTP storage.");
  }

  async function withIssuanceLock(userId, callback) {
    const client = await pool.connect();
    const lockKey = `otp:${String(userId)}`;
    let lockHeld = false;

    try {
      // Keep this session-level lock while the email is dispatched so a resend
      // cannot invalidate a code and then deliver an older code afterward.
      await client.query("SELECT pg_advisory_lock(hashtext($1))", [lockKey]);
      lockHeld = true;

      return await callback({
        async getActiveOtpHash() {
          const result = await client.query(
            `SELECT otp_hash
             FROM ${OTP_REQUESTS_TABLE}
             WHERE user_id = $1
               AND used_at IS NULL
               AND invalidated_at IS NULL
             ORDER BY created_at DESC
             LIMIT 1`,
            [String(userId)]
          );
          return result.rows[0]?.otp_hash || null;
        },

        async createRequest({ requestId, user, otpHash, ttlSeconds }) {
          let transactionOpen = false;

          try {
            await client.query("BEGIN");
            transactionOpen = true;

            const accountResult = await client.query(
              `SELECT id
               FROM users
               WHERE id = $1
                 AND is_verified = FALSE
               FOR UPDATE`,
              [String(user.id)]
            );

            if (accountResult.rows.length === 0) {
              const error = new Error("The patient account is already verified.");
              error.code = "OTP_ACCOUNT_ALREADY_VERIFIED";
              throw error;
            }

            await client.query(
              `UPDATE ${OTP_REQUESTS_TABLE}
               SET invalidated_at = CURRENT_TIMESTAMP
               WHERE user_id = $1
                 AND used_at IS NULL
                 AND invalidated_at IS NULL`,
              [String(user.id)]
            );

            const result = await client.query(
              `INSERT INTO ${OTP_REQUESTS_TABLE}
                 (request_id, user_id, email, phone, otp_hash, expires_at)
               VALUES
                 ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP + ($6::integer * INTERVAL '1 second'))
               RETURNING request_id, created_at, expires_at`,
              [
                requestId,
                String(user.id),
                user.email,
                user.phone,
                otpHash,
                ttlSeconds,
              ]
            );

            await client.query("COMMIT");
            transactionOpen = false;
            return result.rows[0];
          } catch (error) {
            await rollbackIfNeeded(client, transactionOpen);
            throw error;
          }
        },

        async invalidateRequest(requestId) {
          await client.query(
            `UPDATE ${OTP_REQUESTS_TABLE}
             SET invalidated_at = CURRENT_TIMESTAMP
             WHERE request_id = $1
               AND used_at IS NULL
               AND invalidated_at IS NULL`,
            [requestId]
          );
        },
      });
    } finally {
      if (lockHeld) {
        try {
          await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]);
        } catch {
          // The connection release below still prevents an advisory lock leak.
        }
      }
      client.release();
    }
  }

  async function consume({ requestId, otpHash }) {
    const client = await pool.connect();
    let transactionOpen = false;

    try {
      await client.query("BEGIN");
      transactionOpen = true;

      const recordResult = await client.query(
        `SELECT
           request_id,
           user_id,
           email,
           otp_hash,
           created_at,
           expires_at,
           used_at,
           invalidated_at,
           COALESCE(failed_attempts, 0) AS failed_attempts,
           locked_until,
           expires_at <= CURRENT_TIMESTAMP AS expired,
           CASE
             WHEN locked_until IS NULL THEN FALSE
             ELSE locked_until > CURRENT_TIMESTAMP
           END AS is_locked,
           CASE
             WHEN locked_until IS NULL OR locked_until <= CURRENT_TIMESTAMP THEN 0
             ELSE CEIL(EXTRACT(EPOCH FROM (locked_until - CURRENT_TIMESTAMP)))
           END AS retry_after_seconds
         FROM ${OTP_REQUESTS_TABLE}
         WHERE request_id = $1
         FOR UPDATE`,
        [requestId]
      );

      if (recordResult.rows.length === 0) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return { status: "not_found" };
      }

      const record = recordResult.rows[0];
      const auditUser = { id: record.user_id, email: record.email };
      const auditTimestamps = {
        createdAt: record.created_at,
        expiresAt: record.expires_at,
      };

      if (record.used_at || record.invalidated_at) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return { status: "inactive", user: auditUser, ...auditTimestamps };
      }

      if (record.is_locked) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return {
          status: "locked",
          user: auditUser,
          ...auditTimestamps,
          lockedUntil: record.locked_until,
          retryAfterSeconds: Number(record.retry_after_seconds) || LOCKOUT_SECONDS,
          attemptsRemaining: 0,
        };
      }

      // Previous lockout ended — clear the counter before this new attempt.
      if (Number(record.failed_attempts) > 0 && record.locked_until) {
        await client.query(
          `UPDATE ${OTP_REQUESTS_TABLE}
           SET failed_attempts = 0,
               locked_until = NULL
           WHERE request_id = $1`,
          [requestId]
        );
        record.failed_attempts = 0;
        record.locked_until = null;
      }

      if (!isValidTimestamp(record.expires_at)) {
        await client.query(
          `UPDATE ${OTP_REQUESTS_TABLE}
           SET invalidated_at = CURRENT_TIMESTAMP
           WHERE request_id = $1`,
          [requestId]
        );
        await client.query("COMMIT");
        transactionOpen = false;
        return { status: "invalid_expiration", user: auditUser, ...auditTimestamps };
      }

      if (isExpiredValue(record.expired)) {
        await client.query(
          `UPDATE ${OTP_REQUESTS_TABLE}
           SET invalidated_at = CURRENT_TIMESTAMP
           WHERE request_id = $1`,
          [requestId]
        );
        await client.query("COMMIT");
        transactionOpen = false;
        return { status: "expired", user: auditUser, ...auditTimestamps };
      }

      if (!hashesMatch(record.otp_hash, otpHash)) {
        const nextAttempts = Number(record.failed_attempts || 0) + 1;
        const shouldLock = nextAttempts >= MAX_FAILED_ATTEMPTS;

        if (shouldLock) {
          const locked = await client.query(
            `UPDATE ${OTP_REQUESTS_TABLE}
             SET failed_attempts = $2,
                 locked_until = CURRENT_TIMESTAMP + ($3::integer * INTERVAL '1 second')
             WHERE request_id = $1
             RETURNING locked_until,
                       CEIL(EXTRACT(EPOCH FROM (
                         locked_until - CURRENT_TIMESTAMP
                       ))) AS retry_after_seconds`,
            [requestId, nextAttempts, LOCKOUT_SECONDS]
          );
          await client.query("COMMIT");
          transactionOpen = false;
          return {
            status: "locked",
            user: auditUser,
            ...auditTimestamps,
            lockedUntil: locked.rows[0]?.locked_until,
            retryAfterSeconds:
              Number(locked.rows[0]?.retry_after_seconds) || LOCKOUT_SECONDS,
            attemptsRemaining: 0,
          };
        }

        await client.query(
          `UPDATE ${OTP_REQUESTS_TABLE}
           SET failed_attempts = $2
           WHERE request_id = $1`,
          [requestId, nextAttempts]
        );
        await client.query("COMMIT");
        transactionOpen = false;
        return {
          status: "mismatch",
          user: auditUser,
          ...auditTimestamps,
          attemptsRemaining: Math.max(0, MAX_FAILED_ATTEMPTS - nextAttempts),
        };
      }

      const consumeResult = await client.query(
        `UPDATE ${OTP_REQUESTS_TABLE}
         SET used_at = CURRENT_TIMESTAMP,
             failed_attempts = 0,
             locked_until = NULL
         WHERE request_id = $1
           AND used_at IS NULL
           AND invalidated_at IS NULL
           AND expires_at > CURRENT_TIMESTAMP
         RETURNING request_id`,
        [requestId]
      );

      if (consumeResult.rows.length === 0) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return { status: "inactive", user: auditUser, ...auditTimestamps };
      }

      const userResult = await client.query(
        `UPDATE users
         SET is_verified = TRUE
         WHERE id = $1
         RETURNING id, first_name, last_name, email, phone, role, status, is_verified`,
        [record.user_id]
      );

      if (userResult.rows.length === 0) {
        throw new Error("OTP request refers to a user that no longer exists.");
      }

      await client.query("COMMIT");
      transactionOpen = false;

      return {
        status: "verified",
        user: userResult.rows[0],
        ...auditTimestamps,
      };
    } catch (error) {
      await rollbackIfNeeded(client, transactionOpen);
      throw error;
    } finally {
      client.release();
    }
  }

  async function findActiveRequestIdByPhone(phone) {
    const result = await pool.query(
      `SELECT request_id
       FROM ${OTP_REQUESTS_TABLE}
       WHERE phone = $1
         AND used_at IS NULL
         AND invalidated_at IS NULL
         AND expires_at > CURRENT_TIMESTAMP
       ORDER BY created_at DESC
       LIMIT 1`,
      [phone]
    );

    return result.rows[0]?.request_id || null;
  }

  return {
    findActiveRequestIdByPhone,
    withIssuanceLock,
    consume,
  };
}

module.exports = {
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_SECONDS,
  createPostgresOtpStore,
  hashesMatch,
};
