"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("path");
const { spawn } = require("node:child_process");
const test = require("node:test");
const dotenv = require("dotenv");
const express = require("express");
const jwt = require("jsonwebtoken");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const chrome = "/usr/local/bin/google-chrome";
const artifactsDir = "/opt/cursor/artifacts";

test("Staff Check-In RFID/QR UI sanitizes SQL errors at 320, 390, and desktop", { timeout: 120000 }, async (t) => {
  assert.ok(fs.existsSync(chrome), "google-chrome is required for this browser check");
  const { resolveAppSecrets } = require("../lib/securityConfig");
  const { jwtSecret } = resolveAppSecrets(process.env);
  const staffUser = {
    id: 91,
    first_name: "Minda",
    last_name: "Desk",
    email: "staff.checkin.ui@example.test",
    phone: "09170009991",
    role: "staff",
    status: "Active",
  };

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-DentaSync-Branch");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.get("/api/auth/me", (_req, res) => {
    res.json({
      user: {
        id: staffUser.id,
        firstName: staffUser.first_name,
        lastName: staffUser.last_name,
        fullName: "Minda Desk",
        email: staffUser.email,
        phone: staffUser.phone,
        role: "staff",
        status: "active",
        isVerified: true,
      },
      session: { actingAs: false, actAsUserId: null, principal: { role: "staff" } },
    });
  });
  app.get("/api/staff/branch-context", (_req, res) => {
    res.json({
      operational: true,
      branch: { id: 1, name: "Mandaluyong" },
      activeBranches: [{ id: 1, name: "Mandaluyong" }],
    });
  });
  app.get("/api/staff/dashboard", (_req, res) => {
    res.json({ metrics: { unreadNotifications: 0, pendingRequests: 0 }, todaysActivity: [] });
  });
  app.get("/api/staff/check-ins", (_req, res) => {
    res.json({
      checkIns: [],
      label: "Today's Check-In Log",
      subtitle: "",
      emptyDetail: "RFID taps and QR walk-ins will appear here.",
      range: "today",
    });
  });
  app.get("/api/staff/rfid-events", (_req, res) => res.json({ latest: null, events: [] }));
  app.get("/api/staff/check-in/qr-session", (_req, res) => res.json({ session: null }));
  app.post("/api/staff/check-in", (_req, res) => {
    res.status(503).json({
      message: "Check-in setup is incomplete. Apply backend/migrations/066_appointment_visit_origin.sql and retry.",
      errorCode: "SETUP_REQUIRED",
      code: "SETUP_REQUIRED",
    });
  });
  app.post("/api/staff/check-in/qr-session", (_req, res) => {
    res.status(201).json({
      message: "Walk-in QR code generated. Ask the patient to scan it with their phone.",
      session: {
        id: 1,
        token: "aaaaaaaaaaaaaaaaaaaaaaaa",
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        checkInUrl: "http://127.0.0.1:5211/?walkin=aaaaaaaaaaaaaaaaaaaaaaaa",
        qrDataUrl:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      },
    });
  });

  const apiServer = http.createServer(app);
  await new Promise((resolve) => apiServer.listen(0, "127.0.0.1", resolve));
  const apiPort = apiServer.address().port;
  const frontendPort = 5211;
  const frontendUrl = `http://127.0.0.1:${frontendPort}`;
  const vite = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(frontendPort)], {
    cwd: path.join(__dirname, "../../frontend"),
    env: { ...process.env, VITE_PROXY_API: `http://127.0.0.1:${apiPort}` },
    stdio: "pipe",
    detached: true,
  });
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
    await new Promise((resolve) => apiServer.close(resolve));
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
  const token = jwt.sign({ id: String(staffUser.id), role: "staff" }, jwtSecret, { expiresIn: "1h" });

  async function openCheckIn(width, height, filename) {
    await page.setViewport({ width, height, isMobile: width < 800, hasTouch: width < 800 });
    await page.goto(`${frontendUrl}/login`, { waitUntil: "domcontentloaded" });
    await page.evaluate((value) => localStorage.setItem("amethyst_access_token", value), token);
    await page.goto(`${frontendUrl}/staff/check-in`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => document.body.innerText.includes("Listening for card tap"));
    const text = await page.evaluate(() => document.body.innerText);
    assert.match(text, /Connected/);
    assert.match(text, /Tap RFID Card/);
    await page.screenshot({ path: path.join(artifactsDir, filename), fullPage: true });
  }

  await openCheckIn(1280, 900, "staff_checkin_desktop.png");
  await openCheckIn(390, 844, "staff_checkin_390.png");
  await openCheckIn(320, 712, "staff_checkin_320.png");

  await page.focus('input[aria-label="Hidden RFID capture"]');
  await page.keyboard.type("AABBCCDDEE01");
  await page.waitForFunction(
    () => document.body.innerText.includes("Check-in is temporarily unavailable. Contact an administrator to complete setup.")
  );
  const afterFail = await page.evaluate(() => document.body.innerText);
  assert.match(afterFail, /Check-in is temporarily unavailable/);
  assert.doesNotMatch(afterFail, /066_appointment_visit_origin/);
  assert.doesNotMatch(afterFail, /current transaction is aborted/);
  assert.match(afterFail, /Connected/);
  await page.screenshot({ path: path.join(artifactsDir, "staff_checkin_sanitized_error.png"), fullPage: true });

  const clickedQr = await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((node) =>
      /No RFID/i.test(node.textContent || "")
    );
    button?.click();
    return Boolean(button);
  });
  assert.equal(clickedQr, true);
  await page.waitForFunction(() => document.body.innerText.toLowerCase().includes("generate"));
  const qrTab = await page.evaluate(() => document.body.innerText);
  assert.doesNotMatch(qrTab, /066_appointment_visit_origin/);
  assert.match(qrTab, /Generate QR Check-In/);
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((node) =>
      /Generate QR Check-In/i.test(node.textContent || "")
    );
    button?.click();
  });
  await page.waitForFunction(() => document.body.innerText.includes("Ask the patient to scan"));
  await page.screenshot({ path: path.join(artifactsDir, "staff_checkin_qr_tab.png"), fullPage: true });
});
