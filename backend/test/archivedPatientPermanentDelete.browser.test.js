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
const screenshotDir = path.join(__dirname, "../../screenshots/archived-patient-delete");
const frontendPort = 5219;

test("Archived Patients delete confirms, removes one row, and keeps another", { timeout: 180000 }, async (t) => {
  if (!fs.existsSync(chrome)) {
    t.diagnostic("google-chrome is required");
    return;
  }
  const { jwtSecret } = resolveAppSecrets(process.env);
  const admin = {
    id: "11",
    first_name: "Ada",
    last_name: "Admin",
    email: "ada.admin@example.test",
    phone: "09170003333",
    role: "admin",
  };
  let records = [
    {
      id: "91",
      fullName: "Nico Archive",
      email: "nico.archive@example.test",
      patientId: "P202611_99",
      patientCategory: "regular",
      role: "patient",
      originalStatus: "suspended",
      archivedAt: "2026-11-21T00:00:00.000Z",
    },
    {
      id: "92",
      fullName: "Remy Kept",
      email: "remy.kept@example.test",
      patientId: "P202611_98",
      patientCategory: "regular",
      role: "patient",
      originalStatus: "pending",
      archivedAt: "2026-10-22T00:00:00.000Z",
    },
  ];
  let lastDelete = null;

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-DentaSync-Branch");
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
  app.get("/api/admin/archived", (req, res) => {
    const role = String(req.query.role || "staff");
    return res.json({
      records: role === "patient" ? records : [],
    });
  });
  app.delete("/api/admin/archived/:id", (req, res) => {
    lastDelete = { id: req.params.id, body: req.body };
    if (req.body?.confirm !== "delete") {
      return res.status(400).json({ message: 'Send { "confirm": "delete" } to permanently remove this account.' });
    }
    records = records.filter((row) => String(row.id) !== String(req.params.id));
    return res.json({ message: "Account permanently deleted. That email can be used to register again." });
  });

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
  fs.mkdirSync(screenshotDir, { recursive: true });
  const origin = `http://127.0.0.1:${frontendPort}`;
  const token = jwt.sign({ id: String(admin.id), role: "admin" }, jwtSecret, { expiresIn: "1h" });

  async function openArchive(width, height, mobile) {
    await page.setViewport({ width, height, isMobile: Boolean(mobile), hasTouch: Boolean(mobile) });
    await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded" });
    await page.evaluate((value) => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem("amethyst_access_token", value);
    }, token);
    await page.goto(`${origin}/admin/archived-records?role=patient`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => document.body.innerText.includes("Archived Patients"));
  }

  async function shot(name) {
    const dest = path.join(screenshotDir, name);
    await page.screenshot({ path: dest, fullPage: true });
    fs.copyFileSync(dest, path.join(artifactsDir, name));
  }

  await openArchive(1280, 900, false);
  assert.match(await page.evaluate(() => document.body.innerText), /Nico Archive/);
  assert.match(await page.evaluate(() => document.body.innerText), /Remy Kept/);
  await shot("admin-archived-patients-desktop.png");

  await page.evaluate(() => {
    const row = [...document.querySelectorAll("tr")].find((item) => /Nico Archive/i.test(item.textContent || ""));
    [...(row?.querySelectorAll("button") || [])].find((button) => /Delete/i.test(button.textContent || ""))?.click();
  });
  await page.waitForSelector('[role="dialog"][aria-label="Permanently delete account"]');
  assert.match(await page.evaluate(() => document.body.innerText), /nico\.archive@example\.test/);
  assert.match(await page.evaluate(() => document.body.innerText), /Clinical treatment history stays in clinic records/);
  await shot("admin-archived-patient-confirm-desktop.png");
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Cancel")?.click()
  );
  await page.waitForFunction(() => !document.body.innerText.includes("Permanently delete account"));
  assert.match(await page.evaluate(() => document.body.innerText), /Nico Archive/);

  await page.evaluate(() => {
    const row = [...document.querySelectorAll("tr")].find((item) => /Nico Archive/i.test(item.textContent || ""));
    [...(row?.querySelectorAll("button") || [])].find((button) => /Delete/i.test(button.textContent || ""))?.click();
  });
  await page.waitForSelector('[role="dialog"][aria-label="Permanently delete account"]');
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Delete permanently")?.click()
  );
  await page.waitForFunction(() => !document.body.innerText.includes("Nico Archive"));
  assert.equal(lastDelete?.id, "91");
  assert.equal(lastDelete?.body?.confirm, "delete");
  assert.match(await page.evaluate(() => document.body.innerText), /Remy Kept/);
  await shot("admin-archived-patients-after-delete-desktop.png");

  await openArchive(390, 844, true);
  const overflow390 = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  );
  assert.equal(overflow390, false);
  await shot("admin-archived-patients-390.png");

  await openArchive(320, 720, true);
  const overflow320 = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  );
  assert.equal(overflow320, false);
  await shot("admin-archived-patients-320.png");
});
