"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("path");
const { spawn } = require("node:child_process");
const test = require("node:test");
const express = require("express");
const jwt = require("jsonwebtoken");
const { resolveAppSecrets } = require("../lib/securityConfig");

const chrome = "/usr/local/bin/google-chrome";
const artifactsDir = "/opt/cursor/artifacts";
const frontendPort = 5221;

test("Set Credential shows a setup message and keeps dentist-detail save when secret schema is missing", { timeout: 120000 }, async (t) => {
  assert.ok(fs.existsSync(chrome), "google-chrome is required");
  const { jwtSecret } = resolveAppSecrets(process.env);
  const admin = {
    id: "11",
    first_name: "Ada",
    last_name: "Admin",
    email: "ada.admin@example.test",
    phone: "09170003333",
    role: "admin",
  };
  const dentist = {
    id: "91",
    firstName: "Dina",
    lastName: "Synthetic",
    fullName: "Dina Synthetic",
    email: "dina.synthetic@example.test",
    phone: "09170002222",
    role: "dentist",
    status: "active",
    specialization: "General Dentistry",
    authorizationCredentialStatus: "none",
    credentialConfigured: false,
    credentialViewable: false,
    encryptionAvailable: true,
    credentialHashSchemaReady: true,
    credentialSecretSchemaReady: false,
    credentialStorageReady: false,
    credentialSaveReady: false,
    credentialSetupCode: "CREDENTIAL_SECRET_SCHEMA_MISSING",
    credentialSetupMessage:
      "An administrator must finish backend setup before a viewable credential can be stored. From the backend folder run npm run migrate:record-access (061_authorization_credential_secret.sql).",
    branches: [{ id: 1, name: "Main" }],
  };
  let savedDetails = 0;

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  const formatUser = (row) => ({
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    fullName: `${row.first_name} ${row.last_name}`.trim(),
    email: row.email,
    phone: row.phone,
    role: row.role,
    status: "active",
    isVerified: true,
  });
  app.get("/api/auth/me", (_req, res) =>
    res.json({ user: formatUser(admin), session: { actingAs: false, principal: formatUser(admin) } })
  );
  app.get("/api/admin/dashboard", (_req, res) => res.json({ metrics: {} }));
  app.get("/api/admin/notifications", (_req, res) => res.json({ notifications: [], unreadCount: 0 }));
  app.get("/api/admin/branches", (_req, res) => res.json({ branches: [{ id: 1, name: "Main", status: "active" }] }));
  app.get("/api/admin/staff", (_req, res) => res.json({ staff: [] }));
  app.get("/api/admin/dentists", (_req, res) => res.json({ dentists: [dentist] }));
  app.get("/api/admin/registrations/rejected", (_req, res) => res.json({ requests: [] }));
  app.get("/api/admin/registrations/pending", (_req, res) => res.json({ requests: [] }));
  app.get("/api/admin/dentists/:id/authorization-credential", (_req, res) =>
    res.json({ dentist: { id: dentist.id, ...dentist } })
  );
  app.patch("/api/admin/dentists/:id", (req, res) => {
    savedDetails += 1;
    dentist.specialization = req.body?.specialization || dentist.specialization;
    return res.json({ dentist: { ...dentist, specialization: dentist.specialization } });
  });
  app.put("/api/admin/dentists/:id/authorization-credential", (_req, res) =>
    res.status(503).json({
      code: "CREDENTIAL_SECRET_SCHEMA_MISSING",
      message: dentist.credentialSetupMessage,
    })
  );

  let apiServer;
  let vite;
  let browser;
  t.after(async () => {
    if (browser) await browser.close().catch(() => {});
    if (vite?.pid) {
      try {
        process.kill(-vite.pid, "SIGKILL");
      } catch {
        vite.kill("SIGKILL");
      }
    }
    if (apiServer) await new Promise((resolve) => apiServer.close(resolve));
  });

  apiServer = http.createServer(app);
  await new Promise((resolve) => apiServer.listen(0, "127.0.0.1", resolve));
  vite = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(frontendPort)], {
    cwd: path.join(__dirname, "../../frontend"),
    env: { ...process.env, VITE_PROXY_API: `http://127.0.0.1:${apiServer.address().port}` },
    stdio: "pipe",
    detached: true,
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("vite did not start")), 40000);
    vite.stdout.on("data", (chunk) => {
      if (String(chunk).includes("Local:")) {
        clearTimeout(timer);
        resolve();
      }
    });
    vite.stderr.on("data", () => {});
    vite.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`vite exited ${code}`));
    });
  });

  const puppeteer = require("/tmp/node_modules/puppeteer-core");
  browser = await puppeteer.launch({
    executablePath: chrome,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(25000);
  fs.mkdirSync(artifactsDir, { recursive: true });
  const token = jwt.sign({ id: admin.id, role: "admin" }, jwtSecret, { expiresIn: "1h" });
  await page.goto(`http://127.0.0.1:${frontendPort}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate((value) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("amethyst_access_token", value);
  }, token);
  await page.goto(`http://127.0.0.1:${frontendPort}/admin/users?tab=dentist`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.body.innerText.includes("Dina Synthetic"));
  await page.evaluate(() => {
    const row = [...document.querySelectorAll("tr")].find((item) => /Dina Synthetic/i.test(item.textContent || ""));
    [...(row?.querySelectorAll("button") || [])].find((button) => /Edit/i.test(button.textContent || ""))?.click();
  });
  await page.waitForFunction(() => document.body.innerText.includes("Set Credential"));
  await page.$eval(".admin-set-credential", (node) => node.scrollIntoView({ block: "center" }));
  const text = await page.evaluate(() => document.body.innerText);
  assert.match(text, /Setup required/);
  assert.match(text, /migrate:record-access/);
  assert.doesNotMatch(text, /Save credential/);
  assert.match(text, /Save dentist details/);
  assert.doesNotMatch(text, /michi12345/);
  const shot = path.join(artifactsDir, "admin_set_credential_schema_missing.png");
  await page.screenshot({ path: shot, fullPage: false });
  const screenshotDir = path.join(__dirname, "../../screenshots/dentist-credential-schema");
  fs.mkdirSync(screenshotDir, { recursive: true });
  fs.copyFileSync(shot, path.join(screenshotDir, "admin_set_credential_schema_missing.png"));

  await page.evaluate(() => {
    const spec = [...document.querySelectorAll("label")].find((node) => /Specialization/i.test(node.textContent || ""));
    const input = spec?.querySelector("input, textarea");
    if (input) {
      input.focus();
      input.value = "Pediatric Dentistry";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((button) => /Save dentist details/i.test(button.textContent || ""))?.click()
  );
  await page.waitForFunction(() => document.body.innerText.includes("Account updated successfully"));
  assert.ok(savedDetails >= 1, `dentist details should save without credential columns, got ${savedDetails}`);
});
