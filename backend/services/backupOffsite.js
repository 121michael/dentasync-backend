"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function hmac(key, value) {
  return crypto.createHmac("sha256", key).update(value).digest();
}

function isoDateParts(date = new Date()) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { date: iso.slice(0, 8), datetime: `${iso.slice(0, 15)}Z` };
}

function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function createFilesystemStore(rootDir) {
  const root = path.resolve(rootDir);
  fs.mkdirSync(root, { recursive: true });

  async function putObject(key, body, contentType = "application/octet-stream") {
    const full = path.join(root, key);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
    return { key, byteSize: body.length, contentType, etag: sha256Hex(body) };
  }

  async function getObject(key) {
    const full = path.join(root, key);
    if (!fs.existsSync(full)) return null;
    return fs.readFileSync(full);
  }

  async function listObjects(prefix = "") {
    const results = [];
    function walk(current, relative) {
      if (!fs.existsSync(current)) return;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const nextRel = relative ? `${relative}/${entry.name}` : entry.name;
        const nextAbs = path.join(current, entry.name);
        if (entry.isDirectory()) walk(nextAbs, nextRel);
        else if (!prefix || nextRel.startsWith(prefix)) {
          results.push({ key: nextRel, byteSize: fs.statSync(nextAbs).size });
        }
      }
    }
    walk(root, "");
    return results;
  }

  return { kind: "filesystem", putObject, getObject, listObjects };
}

function createS3Store(env) {
  const bucket = String(env.BACKUP_S3_BUCKET || "").trim();
  const accessKey = String(env.BACKUP_S3_ACCESS_KEY_ID || "").trim();
  const secretKey = String(env.BACKUP_S3_SECRET_ACCESS_KEY || "").trim();
  const region = String(env.BACKUP_S3_REGION || "us-east-1").trim();
  const endpoint = String(env.BACKUP_S3_ENDPOINT || "").trim();
  const forcePathStyle = String(env.BACKUP_S3_FORCE_PATH_STYLE || "true").toLowerCase() !== "false";
  if (!bucket || !accessKey || !secretKey) {
    throw new Error("S3 off-site storage is missing bucket or credentials.");
  }

  function objectUrl(key) {
    const encodedKey = key.split("/").map(encodeRfc3986).join("/");
    if (endpoint) {
      const base = endpoint.replace(/\/$/, "");
      return forcePathStyle ? `${base}/${bucket}/${encodedKey}` : `${base}/${encodedKey}`;
    }
    return forcePathStyle
      ? `https://s3.${region}.amazonaws.com/${bucket}/${encodedKey}`
      : `https://${bucket}.s3.${region}.amazonaws.com/${encodedKey}`;
  }

  async function signedRequest(method, key, body, extraHeaders = {}) {
    const url = new URL(objectUrl(key));
    const { date, datetime } = isoDateParts();
    const payloadHash = sha256Hex(body || Buffer.alloc(0));
    const headers = {
      host: url.host,
      "x-amz-date": datetime,
      "x-amz-content-sha256": payloadHash,
      ...extraHeaders,
    };
    if (body) {
      headers["content-length"] = String(body.length);
    }
    const signedHeaderNames = Object.keys(headers)
      .map((name) => name.toLowerCase())
      .sort();
    const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join("");
    const signedHeaders = signedHeaderNames.join(";");
    const canonical = [
      method,
      url.pathname,
      url.searchParams.toString(),
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");
    const credentialScope = `${date}/${region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", datetime, credentialScope, sha256Hex(canonical)].join("\n");
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, date), region), "s3"), "aws4_request");
    const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const response = await fetch(url, { method, headers, body: body && method !== "GET" ? body : undefined });
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!response.ok) {
      const error = new Error(`Off-site storage ${method} failed (${response.status}).`);
      error.status = 502;
      error.detail = buffer.toString("utf8").slice(0, 300);
      throw error;
    }
    return buffer;
  }

  async function putObject(key, body, contentType = "application/octet-stream") {
    await signedRequest("PUT", key, body, {
      "content-type": contentType,
      "x-amz-server-side-encryption": "AES256",
    });
    return { key, byteSize: body.length, contentType, etag: sha256Hex(body) };
  }

  async function getObject(key) {
    try {
      return await signedRequest("GET", key, Buffer.alloc(0));
    } catch (error) {
      if (error.status === 502 && /404|NoSuchKey/i.test(error.detail || "")) return null;
      throw error;
    }
  }

  async function listObjects(prefix = "") {
    const url = new URL(objectUrl(""));
    url.searchParams.set("list-type", "2");
    url.searchParams.set("prefix", prefix);
    const xml = (await signedRequest("GET", `?${url.searchParams.toString()}`, Buffer.alloc(0))).toString("utf8");
    const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((match) => match[1]);
    return keys.map((key) => ({ key, byteSize: null }));
  }

  return { kind: "s3", bucket, region, endpoint: endpoint || null, putObject, getObject, listObjects };
}

function describeOffsite(env = process.env) {
  const bucket = String(env.BACKUP_S3_BUCKET || "").trim();
  const accessKey = String(env.BACKUP_S3_ACCESS_KEY_ID || "").trim();
  const secretKey = String(env.BACKUP_S3_SECRET_ACCESS_KEY || "").trim();
  const disk = String(env.BACKUP_OFFSITE_DIR || "").trim();
  if (bucket && accessKey && secretKey) {
    return {
      configured: true,
      provider: "s3",
      label: "Private S3-compatible object storage",
      status: "configured",
    };
  }
  if (disk) {
    return {
      configured: false,
      independentDisk: true,
      provider: "filesystem",
      label: "Independent disk store (not cloud off-site)",
      status: "Off-site Backup Not Configured",
    };
  }
  return {
    configured: false,
    independentDisk: false,
    provider: null,
    label: "Off-site Backup Not Configured",
    status: "Off-site Backup Not Configured",
  };
}

function createOffsiteStore(env = process.env) {
  const description = describeOffsite(env);
  if (description.provider === "s3") {
    return { ...description, store: createS3Store(env) };
  }
  if (description.provider === "filesystem") {
    return { ...description, store: createFilesystemStore(env.BACKUP_OFFSITE_DIR) };
  }
  return { ...description, store: null };
}

function objectPrefix(env = process.env) {
  return String(env.BACKUP_S3_PREFIX || "dentasync-backups").replace(/^\/+|\/+$/g, "");
}

module.exports = {
  createFilesystemStore,
  createS3Store,
  createOffsiteStore,
  describeOffsite,
  objectPrefix,
  sha256Hex,
};
