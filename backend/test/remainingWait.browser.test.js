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
const screenshotDir = path.join(__dirname, "../../screenshots/patient-queue-remaining");
const frontendPort = 5224;

test("Dentist adding a procedure updates the waiting patient's estimate in the browser", { timeout: 240000 }, async (t) => {
  if (!fs.existsSync(chrome)) {
    t.diagnostic("google-chrome is required");
    return;
  }
  const { jwtSecret } = resolveAppSecrets(process.env);
  const patient = {
    id: "31",
    first_name: "Ned",
    last_name: "Next",
    email: "ned.next@example.test",
    phone: "09170008002",
    role: "patient",
  };

  let added = false;
  function board() {
    const remaining = added ? 20 : 8;
    const later = added ? 30 : 18;
    return {
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
            estimatedWaitMinutes: { min: remaining, max: remaining },
            calculatedAt: "2026-11-22T04:10:00.000Z",
          },
        },
        {
          token: "A-103",
          status: "waiting",
          isCurrentPatient: false,
          waitEstimate: {
            unavailable: false,
            estimatedWaitMinutes: { min: later, max: later },
          },
        },
      ],
      lastUpdatedAt: "2026-11-22T04:10:00.000Z",
    };
  }

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
  app.get("/api/patient/dashboard", (_req, res) => {
    const currentBoard = board();
    return res.json({
      patient: formatUser(patient),
      nextAppointment: null,
      metrics: { activeAppointments: 1, completedVisits: 0, queueToken: "A-102", hmoStatus: "not_enrolled" },
      wellness: { hasAssessment: false },
      queue: currentBoard.entries.find((row) => row.isCurrentPatient),
      queueBoard: currentBoard,
      unreadNotifications: 0,
      recentNotifications: [],
      smsPreferences: { notifySms: true },
    });
  });
  app.get("/api/patient/queue", (_req, res) => {
    const currentBoard = board();
    return res.json({
      nowServing: "A-101",
      current: { ...currentBoard.entries[1], id: 2, token: "A-102", steps: [] },
      queue: currentBoard.entries,
      lastUpdatedAt: currentBoard.lastUpdatedAt,
      notifyWhenNear: false,
    });
  });
  app.post("/api/dentist/queue/1/procedures", (_req, res) => {
    added = true;
    return res.status(201).json({ message: "X-ray added to this visit. The current treatment continues." });
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

  await open("/queue", 1280, 900, false);
  let text = await page.evaluate(() => document.body.innerText);
  assert.match(text, /About 8 min/);
  assert.doesNotMatch(text, /\bNow\b/);
  await shot("remaining-wait-before-add-desktop.png");

  const addedResponse = await page.evaluate(async () => {
    const response = await fetch("/api/dentist/queue/1/procedures", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ treatment: "X-ray", durationMinutes: 12 }),
    });
    return { status: response.status, body: await response.json() };
  });
  assert.equal(addedResponse.status, 201);
  await page.evaluate(() => {
    const refresh = [...document.querySelectorAll("button")].find((button) =>
      String(button.textContent || "").includes("Refresh")
    );
    refresh.click();
  });
  await page.waitForFunction(() => document.body.innerText.includes("About 20 min"), { timeout: 8000 });
  text = await page.evaluate(() => document.body.innerText);
  assert.match(text, /About 20 min/);
  assert.match(text, /About 30 min/);
  await shot("remaining-wait-after-add-desktop.png");

  await open("/queue", 390, 844, true);
  assert.match(await page.evaluate(() => document.body.innerText), /About 20 min/);
  await shot("remaining-wait-after-add-390.png");

  await open("/queue", 320, 720, true);
  assert.match(await page.evaluate(() => document.body.innerText), /About 20 min/);
  const overflow320 = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  );
  assert.equal(overflow320, false);
  await shot("remaining-wait-after-add-320.png");
});
