"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_ROOTS = [
  { name: "prescriptions", relative: path.join("uploads", "prescriptions") },
  { name: "dental-authorizations", relative: path.join("uploads", "dental-authorizations") },
  { name: "patient-portal", relative: path.join("uploads", "patient-portal") },
  { name: "admin-document-sync", relative: path.join("uploads", "admin-document-sync") },
  { name: "medical-documents", relative: path.join("uploads", "medical-documents") },
];

const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_PACK_BYTES = 50 * 1024 * 1024;

function walkFiles(root) {
  const files = [];
  if (!root || !fs.existsSync(root)) return files;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) files.push(full);
    }
  }
  return files;
}

function collectUploadFiles({ cwd = process.cwd(), roots = DEFAULT_ROOTS } = {}) {
  const included = [];
  const omitted = [];
  let packBytes = 0;
  for (const root of roots) {
    const absolute = path.isAbsolute(root.relative) ? root.relative : path.join(cwd, root.relative);
    for (const full of walkFiles(absolute)) {
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      const relativePath = path.relative(cwd, full).split(path.sep).join("/");
      const entry = {
        root: root.name,
        relativePath,
        byteSize: stat.size,
        sha256: null,
        included: false,
      };
      if (stat.size > MAX_FILE_BYTES || packBytes + stat.size > MAX_PACK_BYTES) {
        entry.reason = stat.size > MAX_FILE_BYTES ? "file_too_large" : "pack_budget";
        omitted.push(entry);
        continue;
      }
      const buffer = fs.readFileSync(full);
      entry.sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
      entry.included = true;
      entry.contentBase64 = buffer.toString("base64");
      packBytes += stat.size;
      included.push(entry);
    }
  }
  return {
    included,
    omitted,
    fileCount: included.length + omitted.length,
    includedBytes: packBytes,
  };
}

function restoreUploadFiles(files, { cwd = process.cwd(), dryRun = true } = {}) {
  const restored = [];
  for (const file of files || []) {
    if (!file?.relativePath || !file.contentBase64) continue;
    const target = path.join(cwd, file.relativePath);
    const buffer = Buffer.from(file.contentBase64, "base64");
    const digest = crypto.createHash("sha256").update(buffer).digest("hex");
    if (file.sha256 && digest !== file.sha256) {
      throw new Error(`File checksum mismatch for ${file.relativePath}.`);
    }
    if (!dryRun) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (!fs.existsSync(target)) {
        fs.writeFileSync(target, buffer);
      }
    }
    restored.push({ relativePath: file.relativePath, byteSize: buffer.length, sha256: digest });
  }
  return restored;
}

function stripFileBytes(files) {
  return (files || []).map((file) => ({
    root: file.root,
    relativePath: file.relativePath,
    byteSize: file.byteSize,
    sha256: file.sha256,
    included: Boolean(file.included),
    reason: file.reason || null,
  }));
}

module.exports = {
  DEFAULT_ROOTS,
  collectUploadFiles,
  restoreUploadFiles,
  stripFileBytes,
};
