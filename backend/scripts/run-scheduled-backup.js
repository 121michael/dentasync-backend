"use strict";

/**
 * Independent backup worker. No React frontend and no long-lived web timer.
 * Invoke from a host Cron Job / Render Cron:
 *   node scripts/run-scheduled-backup.js
 */

const db = require("../db");
const { createBackupRecoveryService } = require("../services/backupRecovery");

async function main() {
  const now = process.env.BACKUP_SCHEDULE_NOW ? new Date(process.env.BACKUP_SCHEDULE_NOW) : new Date();
  const service = createBackupRecoveryService({ db, env: process.env });
  const result = await service.runDueScheduledBackup(now);
  const summary = {
    ran: Boolean(result.ran),
    slot: result.slot || null,
    backupId: result.backup?.id || null,
    error: result.error || null,
    at: now.toISOString(),
  };
  console.log(JSON.stringify(summary));
  if (result.error) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ ran: false, error: error.message }));
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await db.end();
    } catch {
      // ignore
    }
  });
