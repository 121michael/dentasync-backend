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
const screenshotDir = path.join(__dirname, "../../screenshots/patient-queue-ticket");
const frontendPort = 5226;

test("Patient Dashboard Queue Ticket layouts waiting, treatment, and empty states", { timeout: 180000 }, async (t) => {
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
  let scenario = "waiting";
  const calculatedAt = "2026-11-22T04:10:00.000Z";
  const tickets = {
    waiting: {
      token: "A-001",
      status: "waiting",
      isCurrentPatient: true,
      waitEstimate: { unavailable: false, estimatedWaitMinutes: { min: 8, max: 8 }, calculatedAt },
    },
    in_treatment: {
      token: "A-001",
      status: "dentist",
      isCurrentPatient: true,
      waitEstimate: { unavailable: false, estimatedWaitMinutes: { min: 0, max: 0 }, calculatedAt },
    },
    completed: {
      token: "A-001",
      status: "completed",
      isCurrentPatient: true,
      waitEstimate: { calculatedAt },
    },
    unavailable: {
      token: "A-001",
      status: "waiting",
      isCurrentPatient: true,
      waitEstimate: { unavailable: true },
    },
    overrun: {
      token: "A-001",
      status: "waiting",
      isCurrentPatient: true,
      waitEstimate: { treatmentOverrun: true, calculatedAt },
    },
  };

  function currentTicket() {
    return scenario === "none" ? null : tickets[scenario];
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
    const queue = currentTicket();
    res.json({
      patient: formatUser(patient),
      nextAppointment: null,
      metrics: { activeAppointments: 1, completedVisits: 0, queueToken: queue?.token || null, hmoStatus: "not_enrolled" },
      wellness: { hasAssessment: false },
      queue,
      queueBoard: {
        entries: queue ? [queue] : [],
        lastUpdatedAt: queue?.waitEstimate?.calculatedAt || null,
      },
      unreadNotifications: 0,
      recentNotifications: [],
      smsPreferences: { notifySms: true },
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

  async function open(width, height, mobile) {
    await page.setViewport({ width, height, isMobile: Boolean(mobile), hasTouch: Boolean(mobile) });
    await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded" });
    await page.evaluate((value) => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem("amethyst_access_token", value);
    }, token);
    await page.goto(`${origin}/dashboard`, { waitUntil: "networkidle0" });
  }

  async function shot(name) {
    const dest = path.join(screenshotDir, name);
    await page.screenshot({ path: dest, fullPage: true });
    fs.copyFileSync(dest, path.join(artifactsDir, name));
  }

  async function ticketText() {
    return page.evaluate(() => {
      const card = document.querySelector(".patient-queue-ticket");
      return card ? card.innerText : "";
    });
  }

  scenario = "waiting";
  await open(1280, 900, false);
  let text = await ticketText();
  assert.match(text, /Your Queue Ticket/);
  assert.match(text, /A-001/);
  assert.match(text, /Estimated wait/);
  assert.match(text, /About 8 min/);
  assert.match(text, /Waiting times may change/);
  assert.match(text, /Last updated 12:10 PM/);
  assert.doesNotMatch(text, /Last updated —/);
  assert.doesNotMatch(text, /In treatment/);
  await shot("patient-queue-ticket-waiting-desktop.png");

  tickets.waiting.waitEstimate.estimatedWaitMinutes = { min: 12, max: 12 };
  await page.waitForFunction(
    () => document.querySelector(".patient-queue-ticket")?.innerText.includes("About 12 min"),
    { timeout: 20000 }
  );
  await shot("patient-queue-ticket-waiting-refresh.png");

  await open(390, 844, true);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1),
    false
  );
  await shot("patient-queue-ticket-waiting-390.png");

  await open(320, 720, true);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1),
    false
  );
  await shot("patient-queue-ticket-waiting-320.png");

  scenario = "in_treatment";
  await open(1280, 900, false);
  text = await ticketText();
  assert.match(text, /Your treatment is underway/);
  assert.match(text, /In Treatment/);
  assert.doesNotMatch(text, /Waiting times may change/);
  assert.doesNotMatch(text, /Last updated —/);
  const treatmentHits = text.match(/In [Tt]reatment/g) || [];
  assert.equal(treatmentHits.length, 1);
  await shot("patient-queue-ticket-treatment-desktop.png");

  scenario = "completed";
  await open(1280, 900, false);
  text = await ticketText();
  assert.match(text, /Completed/);
  assert.doesNotMatch(text, /Waiting times may change/);
  await shot("patient-queue-ticket-completed-desktop.png");

  scenario = "unavailable";
  await open(1280, 900, false);
  text = await ticketText();
  assert.match(text, /Estimate unavailable/);
  assert.doesNotMatch(text, /\bNow\b/);
  assert.doesNotMatch(text, /Last updated —/);
  await shot("patient-queue-ticket-unavailable-desktop.png");

  scenario = "overrun";
  await open(1280, 900, false);
  text = await ticketText();
  assert.match(text, /Treatment running long/);
  await shot("patient-queue-ticket-overrun-desktop.png");

  scenario = "none";
  await open(1280, 900, false);
  const empty = await page.evaluate(() => Boolean(document.querySelector(".patient-queue-ticket")));
  assert.equal(empty, false);
  await shot("patient-queue-ticket-none-desktop.png");
});
