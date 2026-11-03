"use strict";

const http = require("http");
const { URL } = require("url");

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function createS3CompatMock({ bucket = "dentasync-backups" } = {}) {
  const objects = new Map();

  function objectKey(url) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== bucket) return null;
    return parts.slice(1).join("/");
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      if (req.method === "PUT") {
        const key = objectKey(url);
        if (!key) {
          res.writeHead(400);
          res.end("Missing object key");
          return;
        }
        objects.set(`${bucket}/${key}`, body);
        res.writeHead(200, { etag: `"${body.length}"` });
        res.end();
        return;
      }
      if (req.method === "GET" && url.searchParams.get("list-type") === "2") {
        const prefix = url.searchParams.get("prefix") || "";
        const keys = [...objects.keys()]
          .filter((full) => full.startsWith(`${bucket}/`) && full.slice(bucket.length + 1).startsWith(prefix))
          .map((full) => full.slice(bucket.length + 1));
        const contents = keys
          .map((key) => `<Contents><Key>${xmlEscape(key)}</Key><Size>${objects.get(`${bucket}/${key}`).length}</Size></Contents>`)
          .join("");
        res.writeHead(200, { "content-type": "application/xml" });
        res.end(`<?xml version="1.0"?><ListBucketResult><Name>${xmlEscape(bucket)}</Name>${contents}</ListBucketResult>`);
        return;
      }
      if (req.method === "GET") {
        const key = objectKey(url);
        const stored = key ? objects.get(`${bucket}/${key}`) : null;
        if (!stored) {
          res.writeHead(404, { "content-type": "application/xml" });
          res.end("<Error><Code>NoSuchKey</Code></Error>");
          return;
        }
        res.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(stored.length) });
        res.end(stored);
        return;
      }
      res.writeHead(405);
      res.end();
    });
  });

  function listen(port = 0) {
    return new Promise((resolve) => {
      server.listen(port, "127.0.0.1", () => {
        const address = server.address();
        resolve({
          port: address.port,
          url: `http://127.0.0.1:${address.port}`,
          bucket,
        });
      });
    });
  }

  function close() {
    return new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  return { server, objects, listen, close };
}

module.exports = {
  createS3CompatMock,
};
