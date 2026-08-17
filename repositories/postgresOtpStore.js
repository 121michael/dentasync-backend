"use strict";

const crypto = require("crypto");

const OTP_REQUESTS_TABLE = "otp_verification_requests";

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
           expires_at <= CURRENT_TIMESTAMP AS expired
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
        await client.query("ROLLBACK");
        transactionOpen = false;
        return { status: "mismatch", user: auditUser, ...auditTimestamps };
      }

      const consumeResult = await client.query(
        `UPDATE ${OTP_REQUESTS_TABLE}
         SET used_at = CURRENT_TIMESTAMP
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

  return {
    withIssuanceLock,
    consume,
  };
}

module.exports = {
  createPostgresOtpStore,
  hashesMatch,
};
