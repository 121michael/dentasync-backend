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

  function objectUrl(key, query = "") {
    const encodedKey = String(key || "")
      .split("/")
      .filter(Boolean)
      .map(encodeRfc3986)
      .join("/");
    const origin = endpoint ? endpoint.replace(/\/$/, "") : `https://s3.${region}.amazonaws.com`;
    const path =
      forcePathStyle || endpoint
        ? encodedKey
          ? `${origin}/${bucket}/${encodedKey}`
          : `${origin}/${bucket}`
        : encodedKey
          ? `https://${bucket}.s3.${region}.amazonaws.com/${encodedKey}`
          : `https://${bucket}.s3.${region}.amazonaws.com`;
    return query ? `${path}?${query}` : path;
  }

  async function signedRequest(method, href, body, extraHeaders = {}) {
    const url = new URL(href);
    const { date, datetime } = isoDateParts();
    const payload = method === "GET" || method === "HEAD" ? Buffer.alloc(0) : body || Buffer.alloc(0);
    const payloadHash = sha256Hex(payload);
    const headers = {
      host: url.host,
      "x-amz-date": datetime,
      "x-amz-content-sha256": payloadHash,
      ...extraHeaders,
    };
    if (method !== "GET" && method !== "HEAD") {
      headers["content-length"] = String(payload.length);
    }
    const signedHeaderNames = Object.keys(headers)
      .map((name) => name.toLowerCase())
      .sort();
    const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join("");
    const signedHeaders = signedHeaderNames.join(";");
    const canonicalQuery = [...url.searchParams.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => `${encodeRfc3986(name)}=${encodeRfc3986(value)}`)
      .join("&");
    const canonical = [
      method,
      url.pathname,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");
    const credentialScope = `${date}/${region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", datetime, credentialScope, sha256Hex(canonical)].join("\n");
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, date), region), "s3"), "aws4_request");
    const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const response = await fetch(url, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : payload,
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!response.ok) {
      const error = new Error(`Off-site storage ${method} failed (${response.status}).`);
      error.status = response.status === 404 ? 404 : 502;
      error.detail = buffer.toString("utf8").slice(0, 300);
      throw error;
    }
    return buffer;
  }

  async function putObject(key, body, contentType = "application/octet-stream") {
    await signedRequest("PUT", objectUrl(key), body, {
      "content-type": contentType,
      "x-amz-server-side-encryption": "AES256",
    });
    return { key, byteSize: body.length, contentType, etag: sha256Hex(body) };
  }

  async function getObject(key) {
    try {
      return await signedRequest("GET", objectUrl(key));
    } catch (error) {
      if (error.status === 404 || /NoSuchKey/i.test(error.detail || "")) return null;
      throw error;
    }
  }

  async function listObjects(prefix = "") {
    const query = `list-type=2&prefix=${encodeRfc3986(prefix)}`;
    const xml = (await signedRequest("GET", objectUrl("", query))).toString("utf8");
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
