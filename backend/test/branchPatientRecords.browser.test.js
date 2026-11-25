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
const screenshotDir = path.join(__dirname, "../../screenshots/branch-patient-records");
const frontendPort = 5231;

test("Dentist Patient Records identify patients across branches without exposing other-branch history", { timeout: 180000 }, async (t) => {
  if (!fs.existsSync(chrome)) {
    t.diagnostic("google-chrome is required");
    return;
  }
  const { jwtSecret } = resolveAppSecrets(process.env);
  const dentist = {
    id: "71",
    first_name: "Marco",
    last_name: "Mandaluyong",
    email: "marco.mnd@example.test",
    phone: "09170007071",
    role: "dentist",
  };
  const branches = [
    { id: 1, name: "Mandaluyong", branchId: "MND", active: true },
    { id: 2, name: "Taguig", branchId: "TAG", active: true },
  ];
  const directory = [
    { id: 11, fullName: "Tomas Taguig", patientId: "PID-TAG", isClinicalRecord: true },
    { id: 22, fullName: "Mina Mandaluyong", patientId: "PID-MND", isClinicalRecord: true },
  ];

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
  function requestedBranch(req) {
    return String(req.get("x-dentasync-branch") || "1");
  }
  app.get("/api/auth/me", (_req, res) =>
    res.json({ user: formatUser(dentist), session: { actingAs: false, principal: formatUser(dentist) } })
  );
  app.get("/api/dentist/branch-context", (req, res) => {
    const id = Number(requestedBranch(req));
    const branch = branches.find((row) => row.id === id) || branches[0];
    res.json({ operational: true, branch, activeBranches: branches });
  });
  app.get("/api/dentist/dashboard", (_req, res) => res.json({ metrics: { unreadNotifications: 0 } }));
  app.get("/api/dentist/notifications", (_req, res) => res.json({ notifications: [], unreadCount: 0 }));
  app.get("/api/dentist/profile", (_req, res) => res.json({ profile: formatUser(dentist) }));
  app.get("/api/dentist/patients", (_req, res) => {
    res.json({ patients: directory, total: directory.length });
  });
  app.get("/api/dentist/patients/:id", (req, res) => {
    const patient = directory.find((row) => String(row.id) === String(req.params.id));
    if (!patient) return res.status(404).json({ message: "Patient record not found." });
    const active = requestedBranch(req);
    const local = String(patient.id) === "22" && active === "1" || String(patient.id) === "11" && active === "2";
    if (local && String(patient.id) === "22") {
      return res.json({
        patient: { ...patient, patientName: patient.fullName },
        treatments: [{ id: 1, treatment: "Mandaluyong filling", date: "2026-11-20" }],
        appointments: [],
        restrictedHistory: false,
      });
    }
    return res.json({
      patient,
      treatments: [],
      appointments: [],
      restrictedHistory: true,
      restrictedHistoryMessage: "Treatment history from another branch requires authorization.",
    });
  });
  app.get("/api/dentist/patients/:id/dental-chart", (_req, res) => res.json({ patientId: 11, entries: [] }));
  app.get("/api/dentist/patients/:id/xrays", (_req, res) => res.json({ xrays: [] }));
  app.get("/api/dentist/patients/:id/medical-documents", (_req, res) => res.json({ documents: [] }));
  app.get("/api/dentist/patients/:id/prescriptions", (_req, res) => res.json({ prescriptions: [] }));

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
  const token = jwt.sign({ id: String(dentist.id), role: "dentist" }, jwtSecret, { expiresIn: "1h" });

  async function open(width, height, mobile) {
    await page.setViewport({ width, height, isMobile: Boolean(mobile), hasTouch: Boolean(mobile) });
    await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded" });
    await page.evaluate((value) => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem("amethyst_access_token", value);
      sessionStorage.setItem("dentasync.activeBranchId", "1");
    }, token);
    await page.goto(`${origin}/dentist/patient-records`, { waitUntil: "networkidle0" });
  }

  async function shot(name) {
    const dest = path.join(screenshotDir, name);
    await page.screenshot({ path: dest, fullPage: true });
    fs.copyFileSync(dest, path.join(artifactsDir, name));
  }

  await open(1280, 900, false);
  let text = await page.evaluate(() => document.body.innerText);
  assert.match(text, /Tomas Taguig/);
  assert.match(text, /Mina Mandaluyong/);
  assert.doesNotMatch(text, /Mild stain/);
  await shot("branch-patient-records-a-desktop.png");
  await shot("dentist-identity-directory-1280.png");

  await page.goto(`${origin}/dentist/patient-records/11`, { waitUntil: "networkidle0" });
  text = await page.evaluate(() => document.body.innerText);
  assert.match(text, /Tomas Taguig/);
  assert.match(text, /Treatment history from another branch requires authorization/);
  assert.doesNotMatch(text, /Taguig cleaning/);
  assert.doesNotMatch(text, /Mild stain/);
  await shot("dentist-restricted-history-1280.png");

  await open(390, 844, true);
  text = await page.evaluate(() => document.body.innerText);
  assert.match(text, /Tomas Taguig/);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1),
    false
  );
  await shot("branch-patient-records-a-390.png");
  await shot("dentist-identity-directory-390.png");
  await page.goto(`${origin}/dentist/patient-records/11`, { waitUntil: "networkidle0" });
  await page.waitForFunction(
    () => document.body.innerText.includes("Treatment history from another branch requires authorization."),
    { timeout: 10000 }
  );
  await shot("dentist-restricted-history-390.png");

  await open(320, 720, true);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1),
    false
  );
  await shot("branch-patient-records-a-320.png");
  await shot("dentist-identity-directory-320.png");
  await page.goto(`${origin}/dentist/patient-records/11`, { waitUntil: "networkidle0" });
  await page.waitForFunction(
    () => document.body.innerText.includes("Treatment history from another branch requires authorization."),
    { timeout: 10000 }
  );
  await shot("dentist-restricted-history-320.png");
});
