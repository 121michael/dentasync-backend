"use strict";

const crypto = require("crypto");

const PASSWORD_RESET_REQUESTS_TABLE = "password_reset_requests";

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

function createPostgresPasswordResetStore(pool) {
  if (!pool || typeof pool.connect !== "function") {
    throw new Error("A PostgreSQL connection pool is required for password reset storage.");
  }

  async function withIssuanceLock(userId, callback) {
    const client = await pool.connect();
    const lockKey = `password-reset:${String(userId)}`;
    let lockHeld = false;

    try {
      await client.query("SELECT pg_advisory_lock(hashtext($1))", [lockKey]);
      lockHeld = true;

      return await callback({
        async createRequest({ requestId, user, tokenHash, ttlSeconds }) {
          let transactionOpen = false;
          try {
            await client.query("BEGIN");
            transactionOpen = true;

            const accountResult = await client.query(
              `SELECT id
               FROM users
               WHERE id = $1
                 AND role = 'patient'
                 AND is_verified = TRUE
               FOR UPDATE`,
              [String(user.id)]
            );
            if (accountResult.rows.length === 0) {
              const error = new Error("The patient account is unavailable for a password reset.");
              error.code = "PASSWORD_RESET_ACCOUNT_UNAVAILABLE";
              throw error;
            }

            await client.query(
              `UPDATE ${PASSWORD_RESET_REQUESTS_TABLE}
               SET invalidated_at = CURRENT_TIMESTAMP
               WHERE user_id = $1
                 AND used_at IS NULL
                 AND invalidated_at IS NULL`,
              [String(user.id)]
            );

            const result = await client.query(
              `INSERT INTO ${PASSWORD_RESET_REQUESTS_TABLE}
                 (request_id, user_id, token_hash, expires_at)
               VALUES
                 ($1, $2, $3, CURRENT_TIMESTAMP + ($4::integer * INTERVAL '1 second'))
               RETURNING
                 request_id AS "requestId",
                 created_at AS "createdAt",
                 expires_at AS "expiresAt"`,
              [requestId, String(user.id), tokenHash, ttlSeconds]
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
            `UPDATE ${PASSWORD_RESET_REQUESTS_TABLE}
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
          // Closing the session below also releases an advisory lock.
        }
      }
      client.release();
    }
  }

  async function consumeAndReset({ tokenHash, passwordHash }) {
    const client = await pool.connect();
    let transactionOpen = false;

    try {
      await client.query("BEGIN");
      transactionOpen = true;

      const recordResult = await client.query(
        `SELECT
           r.request_id,
           r.user_id,
           r.token_hash,
           r.created_at,
           r.expires_at,
           r.used_at,
           r.invalidated_at,
           r.expires_at <= CURRENT_TIMESTAMP AS expired,
           u.email
         FROM ${PASSWORD_RESET_REQUESTS_TABLE} r
         LEFT JOIN users u ON u.id = r.user_id
         WHERE r.token_hash = $1
         FOR UPDATE OF r`,
        [tokenHash]
      );

      if (recordResult.rows.length === 0) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return { status: "not_found" };
      }

      const record = recordResult.rows[0];
      const auditDetails = {
        requestId: record.request_id,
        user: { id: record.user_id, email: record.email },
        createdAt: record.created_at,
        expiresAt: record.expires_at,
      };

      if (record.used_at || record.invalidated_at) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return { status: "inactive", ...auditDetails };
      }

      if (!isValidTimestamp(record.expires_at)) {
        await client.query(
          `UPDATE ${PASSWORD_RESET_REQUESTS_TABLE}
           SET invalidated_at = CURRENT_TIMESTAMP
           WHERE request_id = $1`,
          [record.request_id]
        );
        await client.query("COMMIT");
        transactionOpen = false;
        return { status: "invalid_expiration", ...auditDetails };
      }

      if (isExpiredValue(record.expired)) {
        await client.query(
          `UPDATE ${PASSWORD_RESET_REQUESTS_TABLE}
           SET invalidated_at = CURRENT_TIMESTAMP
           WHERE request_id = $1`,
          [record.request_id]
        );
        await client.query("COMMIT");
        transactionOpen = false;
        return { status: "expired", ...auditDetails };
      }

      if (!hashesMatch(record.token_hash, tokenHash)) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return { status: "mismatch", ...auditDetails };
      }

      const consumeResult = await client.query(
        `UPDATE ${PASSWORD_RESET_REQUESTS_TABLE}
         SET used_at = CURRENT_TIMESTAMP
         WHERE request_id = $1
           AND used_at IS NULL
           AND invalidated_at IS NULL
           AND expires_at > CURRENT_TIMESTAMP
         RETURNING request_id`,
        [record.request_id]
      );
      if (consumeResult.rows.length === 0) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return { status: "inactive", ...auditDetails };
      }

      const userResult = await client.query(
        `UPDATE users
         SET password_hash = $1,
             password_changed_at = CURRENT_TIMESTAMP
         WHERE id = $2
           AND role = 'patient'
         RETURNING id, email`,
        [passwordHash, record.user_id]
      );
      if (userResult.rows.length === 0) {
        throw new Error("Password reset request refers to an unavailable patient.");
      }

      await client.query(
        `UPDATE ${PASSWORD_RESET_REQUESTS_TABLE}
         SET invalidated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1
           AND request_id <> $2
           AND used_at IS NULL
           AND invalidated_at IS NULL`,
        [record.user_id, record.request_id]
      );
      await client.query("COMMIT");
      transactionOpen = false;

      return {
        status: "reset",
        ...auditDetails,
        user: userResult.rows[0],
      };
    } catch (error) {
      await rollbackIfNeeded(client, transactionOpen);
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    consumeAndReset,
    withIssuanceLock,
  };
}

module.exports = {
  createPostgresPasswordResetStore,
  hashesMatch,
};
