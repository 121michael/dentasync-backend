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
const frontendPort = 5221;

test("Queue Status live wait times layout at 320, 390, and desktop", { timeout: 240000 }, async (t) => {
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
  const waitingBoard = {
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
        waitEstimate: {
          unavailable: false,
          estimatedWaitMinutes: { min: 20, max: 20 },
          calculatedAt: "2026-11-22T04:10:00.000Z",
        },
      },
      {
        token: "A-201",
        status: "waiting",
        isCurrentPatient: false,
        waitEstimate: { unavailable: true },
      },
    ],
    lastUpdatedAt: "2026-11-22T04:10:00.000Z",
  };
  let mode = "waiting";
  let failQueue = false;

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
      queue: waitingBoard.entries.find((row) => row.isCurrentPatient),
      queueBoard: waitingBoard,
      unreadNotifications: 0,
      recentNotifications: [],
      smsPreferences: { notifySms: true },
    })
  );
  app.get("/api/patient/queue", (_req, res) => {
    if (failQueue) return res.status(503).json({ message: "Queue temporarily unavailable" });
    if (mode === "empty") {
      return res.json({
        nowServing: null,
        current: null,
        queue: [],
        lastUpdatedAt: null,
        notifyWhenNear: false,
      });
    }
    const board = waitingBoard;
    const currentEntry =
      mode === "in-treatment"
        ? { ...board.entries[0], isCurrentPatient: true, id: 1, token: "A-101", steps: [] }
        : { ...board.entries[1], id: 2, token: "A-102", steps: [] };
    const entries =
      mode === "in-treatment"
        ? [
            { ...board.entries[0], isCurrentPatient: true },
            { ...board.entries[1], isCurrentPatient: false },
            board.entries[2],
          ]
        : board.entries;
    return res.json({
      nowServing: "A-101",
      current: currentEntry,
      queue: entries,
      lastUpdatedAt: board.lastUpdatedAt,
      notifyWhenNear: false,
    });
  });
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
  const dashboard = await page.evaluate(() => document.body.innerText);
  assert.match(dashboard, /Live wait times/);
  assert.match(dashboard, /Your estimated wait/i);
  assert.match(dashboard, /About 20 min/);
  assert.match(dashboard, /In treatment/);
  assert.match(dashboard, /Estimate unavailable/);
  assert.match(dashboard, /Last updated/);
  assert.doesNotMatch(dashboard, /nico\.queue@example\.test/);
  await shot("patient-dashboard-queue-desktop.png");

  await open("/queue", 1280, 900, false);
  const queueDesktop = await page.evaluate(() => document.body.innerText);
  assert.match(queueDesktop, /Live wait times/);
  assert.match(queueDesktop, /Estimates may change as patients are called/);
  assert.match(queueDesktop, /Your estimated wait/i);
  assert.match(queueDesktop, /About 20 min/);
  assert.match(queueDesktop, /In treatment/);
  assert.match(queueDesktop, /Waiting/);
  assert.match(queueDesktop, /Estimate unavailable/);
  assert.match(queueDesktop, /Last updated/);
  assert.match(queueDesktop, /Notify me when it’s almost my turn/);
  assert.doesNotMatch(queueDesktop, /Estimated waiting time/i);
  assert.doesNotMatch(queueDesktop, /Estimated call time/i);
  assert.doesNotMatch(
    queueDesktop,
    /Estimates are approximate and may change depending on actual treatment duration and queue conditions/
  );
  const featuredCount = await page.evaluate(
    () => document.querySelectorAll(".patient-queue-board__featured").length
  );
  assert.equal(featuredCount, 1);
  await shot("patient-queue-page-desktop.png");

  await open("/queue", 390, 844, true);
  const overflow390 = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  );
  assert.equal(overflow390, false);
  await shot("patient-queue-page-390.png");

  await open("/queue", 320, 720, true);
  const overflow320 = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  );
  assert.equal(overflow320, false);
  await shot("patient-queue-page-320.png");

  mode = "in-treatment";
  await open("/queue", 1280, 900, false);
  const treating = await page.evaluate(() => document.body.innerText);
  assert.match(treating, /In treatment/);
  assert.match(treating, /Your estimated wait/i);
  await shot("patient-queue-page-in-treatment.png");

  mode = "empty";
  await open("/queue", 1280, 900, false);
  const empty = await page.evaluate(() => document.body.innerText);
  assert.match(empty, /No active queue ticket/);
  assert.doesNotMatch(empty, /Your estimated wait/i);
  assert.doesNotMatch(empty, /Last updated/);
  await shot("patient-queue-page-empty.png");

  mode = "waiting";
  failQueue = false;
  await open("/queue", 1280, 900, false);
  failQueue = true;
  await page.evaluate(() => {
    const refresh = [...document.querySelectorAll("button")].find((button) =>
      String(button.textContent || "").includes("Refresh")
    );
    if (!refresh) throw new Error("Refresh button missing");
    refresh.click();
  });
  await page.waitForFunction(() => document.body.innerText.includes("Queue temporarily unavailable"), {
    timeout: 8000,
  }).catch(async () => {
    const text = await page.evaluate(() => document.body.innerText);
    throw new Error(`failed refresh did not show error: ${text.slice(0, 400)}`);
  });
  const failed = await page.evaluate(() => document.body.innerText);
  assert.match(failed, /Queue temporarily unavailable/);
  assert.match(failed, /Your estimated wait/i);
  assert.match(failed, /Last updated/);
  await shot("patient-queue-page-failed-refresh.png");

  await open("/dashboard", 390, 844, true);
  await shot("patient-dashboard-queue-390.png");
  await open("/dashboard", 320, 720, true);
  await shot("patient-dashboard-queue-320.png");
});
