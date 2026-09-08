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
