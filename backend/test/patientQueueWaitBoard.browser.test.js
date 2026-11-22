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
const screenshotDir = path.join(__dirname, "../../screenshots/patient-queue-wait");
const frontendPort = 5220;

test("Patient Dashboard Queue shows compact waits at 320, 390, and desktop", { timeout: 180000 }, async (t) => {
  if (!fs.existsSync(chrome)) {
    t.diagnostic("google-chrome is required");
    return;
  }
  const { jwtSecret } = resolveAppSecrets(process.env);
  const patient = {
    id: "21",
    first_name: "Nico",
    last_name: "Queue",
    email: "nico.queue@example.test",
    phone: "09170007001",
    role: "patient",
  };
  let emptyBoard = false;
  const board = {
    entries: [
      {
        token: "A-101",
        status: "dentist",
        isCurrentPatient: false,
        waitEstimate: { unavailable: false, estimatedWaitMinutes: { min: 0, max: 0 } },
      },
      {
        token: "A-102",
        status: "waiting",
        isCurrentPatient: true,
        waitEstimate: { unavailable: false, estimatedWaitMinutes: { min: 20, max: 20 }, calculatedAt: "2026-11-22T04:10:00.000Z" },
      },
      {
        token: "A-201-LONGWAITLABEL",
        status: "waiting",
        isCurrentPatient: false,
        waitEstimate: { unavailable: true },
      },
    ],
    lastUpdatedAt: "2026-11-22T04:10:00.000Z",
  };
  const emptyPayload = { entries: [], lastUpdatedAt: null };

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
    res.json({ user: formatUser(patient), session: { actingAs: false, principal: formatUser(patient) } })
  );
  app.get("/api/patient/dashboard", (_req, res) =>
    res.json({
      patient: formatUser(patient),
      nextAppointment: null,
      metrics: { activeAppointments: 1, completedVisits: 0, queueToken: "A-102", hmoStatus: "not_enrolled" },
      wellness: { hasAssessment: false },
      queue: emptyBoard ? null : board.entries.find((row) => row.isCurrentPatient),
      queueBoard: emptyBoard ? emptyPayload : board,
      unreadNotifications: 0,
      recentNotifications: [],
      smsPreferences: { notifySms: true },
    })
  );
  app.get("/api/patient/queue", (_req, res) =>
    res.json({
      nowServing: "A-101",
      current: emptyBoard ? null : { ...board.entries[1], id: 2, token: "A-102", steps: [] },
      queue: emptyBoard ? [] : board.entries,
      lastUpdatedAt: emptyBoard ? null : board.lastUpdatedAt,
      notifyWhenNear: false,
    })
  );
  app.get("/api/patient/appointments", (_req, res) => res.json({ appointments: [] }));
  app.get("/api/patient/notifications", (_req, res) => res.json({ notifications: [], unreadCount: 0 }));

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
  const token = jwt.sign({ id: String(patient.id), role: "patient" }, jwtSecret, { expiresIn: "1h" });

  async function open(pathName, width, height, mobile) {
    await page.setViewport({ width, height, isMobile: Boolean(mobile), hasTouch: Boolean(mobile) });
    await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded" });
    await page.evaluate((value) => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem("amethyst_access_token", value);
    }, token);
    await page.goto(`${origin}${pathName}`, { waitUntil: "networkidle0" });
  }

  async function shot(name) {
    const dest = path.join(screenshotDir, name);
    await page.screenshot({ path: dest, fullPage: true });
    fs.copyFileSync(dest, path.join(artifactsDir, name));
  }

  await open("/dashboard", 1280, 900, false);
  const desktop = await page.evaluate(() => document.body.innerText);
  assert.match(desktop, /Live Queue/);
  assert.match(desktop, /Your queue position and estimated waiting time/);
  assert.match(desktop, /Your ticket/);
  assert.match(desktop, /About 20 min/);
  assert.match(desktop, /Estimated wait: About 20 min/);
  assert.match(desktop, /QUEUE TICKET/i);
  assert.match(desktop, /Estimates may change as treatments progress/);
  assert.match(desktop, /In treatment/);
  assert.match(desktop, /Estimate unavailable/);
  assert.match(desktop, /Last updated 12:10 PM/);
  assert.doesNotMatch(desktop, /Last updated —/);
  assert.doesNotMatch(desktop, /Queue numbers only/);
  assert.doesNotMatch(desktop, /nico\.queue@example\.test/);
  await shot("patient-dashboard-queue-desktop.png");

  await open("/queue", 1280, 900, false);
  const queueText = await page.evaluate(() => document.body.innerText);
  assert.match(queueText, /Live Queue/);
  assert.match(queueText, /Your ticket/);
  assert.match(queueText, /About 20 min/);
  assert.match(queueText, /Estimated wait: About 20 min/);
  await shot("patient-queue-page-desktop.png");

  await open("/dashboard", 390, 844, true);
  const overflow390 = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  );
  assert.equal(overflow390, false);
  await shot("patient-dashboard-queue-390.png");

  await open("/dashboard", 320, 720, true);
  const overflow320 = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  );
  assert.equal(overflow320, false);
  await shot("patient-dashboard-queue-320.png");

  emptyBoard = true;
  await open("/dashboard", 1280, 900, false);
  const emptyDesktop = await page.evaluate(() => document.body.innerText);
  assert.match(emptyDesktop, /No active queue ticket/);
  assert.match(emptyDesktop, /Check in at the clinic to see your queue number and estimated wait/);
  assert.doesNotMatch(emptyDesktop, /Last updated —/);
  await shot("patient-dashboard-queue-empty-desktop.png");

  await open("/dashboard", 390, 844, true);
  await shot("patient-dashboard-queue-empty-390.png");
  await open("/dashboard", 320, 720, true);
  const emptyOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  );
  assert.equal(emptyOverflow, false);
  await shot("patient-dashboard-queue-empty-320.png");
});
