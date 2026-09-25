"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const {
  resolveTempDocumentPath,
  discardTemporaryDocumentFile,
  temporaryDocumentExists,
  expireTemporaryDocumentScans,
} = require("../services/documentSyncTempStorage");

test("temporary document paths stay inside the upload directory", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "doc-sync-"));
  assert.equal(resolveTempDocumentPath(dir, "../escape.pdf"), null);
  assert.ok(resolveTempDocumentPath(dir, "safe.png").startsWith(dir));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("discardTemporaryDocumentFile removes the on-disk source", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "doc-sync-"));
  const name = "temp-scan.jpg";
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, "temporary");
  assert.equal(temporaryDocumentExists(dir, name), true);
  assert.equal(discardTemporaryDocumentFile(dir, name), true);
  assert.equal(temporaryDocumentExists(dir, name), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("expired scans delete the temp file and unsaved job, not a linked patient", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "doc-sync-"));
  const stored = "expired-scan.jpg";
  fs.writeFileSync(path.join(dir, stored), "scan");
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/SELECT id, stored_name/.test(sql)) {
        return {
          rows: [
            { id: 9, stored_name: stored, status: "extracted", linked_patient_id: null },
            { id: 10, stored_name: null, status: "synced", linked_patient_id: "A2026_01" },
          ],
        };
      }
      return { rows: [] };
    },
  };
  const expired = await expireTemporaryDocumentScans(db, dir);
  assert.equal(expired, 2);
  assert.equal(temporaryDocumentExists(dir, stored), false);
  assert.ok(calls.some((item) => /DELETE FROM admin_portal_document_sync_jobs/.test(item.sql)));
  assert.ok(calls.some((item) => /SET stored_name = NULL/.test(item.sql)));
  assert.ok(!calls.some((item) => /clinic_patient/.test(item.sql)));
  fs.rmSync(dir, { recursive: true, force: true });
});
