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
const screenshotDir = path.join(__dirname, "../../screenshots/patient-current-queue");
const frontendPort = 5232;

test("Patient Dashboard hides stale tickets and labels walk-in history", { timeout: 180000 }, async (t) => {
  assert.ok(fs.existsSync(chrome), "google-chrome is required");
  const { jwtSecret } = resolveAppSecrets(process.env);
  const patient = {
    id: "44",
    first_name: "Algene",
    last_name: "Synthetic",
    email: "algene.synthetic@example.test",
    phone: "09170004001",
    role: "patient",
  };
  let mode = "empty";
  const liveTicket = {
    token: "B-014",
    status: "waiting",
    visitType: "walk_in",
    isCurrentPatient: true,
    waitEstimate: { unavailable: false, estimatedWaitMinutes: { min: 12, max: 18 }, calculatedAt: "2026-11-24T04:10:00.000Z" },
  };
  const appointments = [
    {
      id: 1,
      service: "Walk-in Consultation",
      treatment: "Walk-in Consultation",
      date: "2026-11-23",
      time: "11:30",
      status: "checked_in",
      statusLabel: "Not served",
      visitType: "walk_in",
      visitTypeLabel: "Walk-in visit",
      canCancel: false,
      canReschedule: false,
      branchName: "Mandaluyong",
    },
    {
      id: 2,
      service: "Walk-in Consultation",
      treatment: "Walk-in Consultation",
      date: "2026-11-20",
      time: "12:00",
      status: "checked_in",
      statusLabel: "Not served",
      visitType: "walk_in",
      visitTypeLabel: "Walk-in visit",
      canCancel: false,
      canReschedule: false,
      branchName: "Mandaluyong",
    },
  ];

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
    res.json({ user: formatUser(patient), session: { actingAs: false, principal: formatUser(patient) } })
  );
  app.get("/api/patient/dashboard", (_req, res) =>
    res.json({
      patient: formatUser(patient),
      nextAppointment: null,
      metrics: {
        activeAppointments: mode === "live" ? 1 : 0,
        completedVisits: 0,
        queueToken: mode === "live" ? liveTicket.token : null,
        hmoStatus: "not_enrolled",
      },
      wellness: { hasAssessment: false },
      queue: mode === "live" ? liveTicket : null,
      queueBoard: mode === "live" ? { entries: [liveTicket], lastUpdatedAt: liveTicket.waitEstimate.calculatedAt } : { entries: [], lastUpdatedAt: null },
      unreadNotifications: 0,
      recentNotifications: [],
      smsPreferences: { notifySms: true },
    })
  );
  app.get("/api/patient/queue", (_req, res) =>
    res.json({
      nowServing: mode === "live" ? "B-010" : null,
      current: mode === "live" ? { ...liveTicket, id: 9, steps: [] } : null,
      queue: mode === "live" ? [liveTicket] : [],
      lastUpdatedAt: mode === "live" ? liveTicket.waitEstimate.calculatedAt : null,
      notifyWhenNear: false,
    })
  );
  app.get("/api/patient/appointments", (_req, res) => res.json({ appointments }));
  app.get("/api/patient/catalog", (_req, res) => res.json({ clinicServices: [], dentists: [] }));
  app.get("/api/patient/dependents", (_req, res) => res.json({ dependents: [] }));
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
  let text = await page.evaluate(() => document.body.innerText);
  assert.match(text, /No active queue ticket/);
  assert.doesNotMatch(text, /A-001/);
  await shot("patient-current-queue-empty-desktop.png");
  await open("/dashboard", 390, 844, true);
  await shot("patient-current-queue-empty-390.png");
  await open("/dashboard", 320, 720, true);
  await shot("patient-current-queue-empty-320.png");

  await open("/queue", 1280, 900, false);
  text = await page.evaluate(() => document.body.innerText);
  assert.match(text, /No active queue ticket/);
  await shot("patient-queue-status-empty-desktop.png");

  await open("/appointments", 1280, 900, false);
  text = await page.evaluate(() => document.body.innerText);
  assert.match(text, /Walk-in visit/);
  assert.match(text, /Not served/);
  assert.doesNotMatch(text, /No-show/);
  await shot("patient-appointments-stale-walkin-desktop.png");
  await open("/appointments", 390, 844, true);
  await shot("patient-appointments-stale-walkin-390.png");
  await open("/appointments", 320, 720, true);
  await shot("patient-appointments-stale-walkin-320.png");

  mode = "live";
  await open("/dashboard", 1280, 900, false);
  text = await page.evaluate(() => document.body.innerText);
  assert.match(text, /B-014/);
  assert.match(text, /Walk-in visit/);
  await shot("patient-current-queue-walkin-desktop.png");
  await open("/dashboard", 390, 844, true);
  await shot("patient-current-queue-walkin-390.png");
  await open("/dashboard", 320, 720, true);
  await shot("patient-current-queue-walkin-320.png");
});
