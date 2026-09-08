"use strict";

const fs = require("fs");
const path = require("path");

function resolveTempDocumentPath(uploadDirectory, storedName) {
  if (!uploadDirectory || !storedName) return null;
  const base = path.resolve(uploadDirectory);
  const candidate = path.resolve(uploadDirectory, storedName);
  if (!candidate.startsWith(base + path.sep) && candidate !== base) {
    return null;
  }
  return candidate;
}

function discardTemporaryDocumentFile(uploadDirectory, storedName) {
  const filePath = resolveTempDocumentPath(uploadDirectory, storedName);
  if (!filePath) {
    return false;
  }
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch (error) {
    console.warn("Unable to discard temporary document:", error.message);
  }
  return false;
}

function temporaryDocumentExists(uploadDirectory, storedName) {
  const filePath = resolveTempDocumentPath(uploadDirectory, storedName);
  return Boolean(filePath && fs.existsSync(filePath));
}

/**
 * Clear DB references and delete the temporary source document.
 * Only structured extracted/confirmed data should remain.
 */
async function discardJobSourceDocument(db, uploadDirectory, jobId, storedName) {
  discardTemporaryDocumentFile(uploadDirectory, storedName);
  if (!db || !jobId) {
    return;
  }
  try {
    await db.query(
      `UPDATE admin_portal_document_sync_jobs
       SET stored_name = NULL,
           raw_text = NULL,
           byte_size = 0,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [jobId]
    );
  } catch (error) {
    console.warn("Unable to clear temporary document references:", error.message);
  }
}

/**
 * Remove leftover temp files for finished jobs and unreferenced disk files.
 */
async function cleanupFinishedDocumentTemps(db, uploadDirectory) {
  if (!db || !uploadDirectory) return;

  try {
    const leftover = await db.query(
      `SELECT id, stored_name
       FROM admin_portal_document_sync_jobs
       WHERE stored_name IS NOT NULL
         AND status IN ('synced', 'failed')`
    );
    for (const row of leftover.rows) {
      await discardJobSourceDocument(db, uploadDirectory, row.id, row.stored_name);
    }
  } catch (error) {
    if (error?.code !== "42P01") {
      console.warn("Temporary document cleanup skipped:", error.message);
    }
  }

  try {
    if (!fs.existsSync(uploadDirectory)) return;
    const active = await db.query(
      `SELECT stored_name
       FROM admin_portal_document_sync_jobs
       WHERE stored_name IS NOT NULL
         AND status IN ('uploaded', 'extracted', 'reviewed')`
    );
    const keep = new Set(active.rows.map((row) => row.stored_name).filter(Boolean));
    for (const entry of fs.readdirSync(uploadDirectory)) {
      if (!keep.has(entry)) {
        discardTemporaryDocumentFile(uploadDirectory, entry);
      }
    }
  } catch (error) {
    console.warn("Orphan temporary document cleanup skipped:", error.message);
  }
}

module.exports = {
  resolveTempDocumentPath,
  discardTemporaryDocumentFile,
  temporaryDocumentExists,
  discardJobSourceDocument,
  cleanupFinishedDocumentTemps,
};
