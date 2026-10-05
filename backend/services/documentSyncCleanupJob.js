"use strict";

const { expireTemporaryDocumentScans, cleanupFinishedDocumentTemps } = require("./documentSyncTempStorage");

function createDocumentSyncCleanupJob({
  db,
  uploadDirectory,
  intervalMs = 15 * 60 * 1000,
} = {}) {
  let timer = null;

  async function runOnce() {
    if (!db || !uploadDirectory) return { expired: 0, skipped: true };
    const expired = await expireTemporaryDocumentScans(db, uploadDirectory);
    await cleanupFinishedDocumentTemps(db, uploadDirectory);
    return { expired, skipped: false };
  }

  function start() {
    if (timer) return;
    setTimeout(() => {
      runOnce()
        .then((result) => {
          if (!result?.skipped) {
            console.log(`Document sync temp cleanup: expired=${result.expired || 0}`);
          }
        })
        .catch((error) => console.warn("Document sync cleanup error:", error.message));
    }, 15_000);
    timer = setInterval(() => {
      runOnce().catch((error) => console.warn("Document sync cleanup interval error:", error.message));
    }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop, runOnce };
}

module.exports = {
  createDocumentSyncCleanupJob,
};
