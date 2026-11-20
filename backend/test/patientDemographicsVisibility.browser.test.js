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
const screenshotDir = path.join(__dirname, "../../screenshots/patient-demographics-display");
const frontendPort = 5214;

function formatUser(row) {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    fullName: `${row.first_name} ${row.last_name}`.trim(),
    email: row.email,
    phone: row.phone,
    role: row.role,
    status: "active",
    isVerified: true,
  };
}

test("four roles show Sex and Date of birth after reload", { timeout: 180000 }, async (t) => {
  if (!fs.existsSync(chrome)) {
    t.diagnostic("google-chrome is required");
    return;
  }
  const { jwtSecret } = resolveAppSecrets(process.env);
  const users = {
    patient: {
      id: "71",
      first_name: "Lila",
      last_name: "Synthetic",
      email: "lila.synthetic@example.test",
      phone: "09175551101",
      role: "patient",
    },
    staff: {
      id: "81",
      first_name: "Sana",
      last_name: "Staff",
      email: "sana.staff@example.test",
      phone: "09170001111",
      role: "staff",
    },
    dentist: {
      id: "91",
      first_name: "Dina",
      last_name: "Dentist",
      email: "dina.dentist@example.test",
      phone: "09170002222",
      role: "dentist",
    },
    admin: {
      id: "11",
      first_name: "Ada",
      last_name: "Admin",
      email: "ada.admin@example.test",
      phone: "09170003333",
      role: "admin",
    },
  };

  const patientPayload = {
    id: 42,
    fullName: "Lila Synthetic",
    patientName: "Lila Synthetic",
    patientId: "A-2026-1101",
    recordCode: "A-2026-1101",
    age: 25,
    gender: "Female",
    dateOfBirth: "2001-06-15",
    phone: "09175551101",
    email: "lila.synthetic@example.test",
    patientCategory: "regular",
    profileLocked: true,
    linkedUserId: "71",
  };
  const missingPayload = {
    ...patientPayload,
    id: 43,
    fullName: "Lea Legacy",
    patientName: "Lea Legacy",
    patientId: "A-2020-0101",
    gender: "",
    dateOfBirth: null,
    age: null,
    email: "lea.legacy@example.test",
  };

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-DentaSync-Branch");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  function currentUser(req) {
    const header = String(req.headers.authorization || "");
    const token = header.replace(/^Bearer\s+/i, "");
    const payload = jwt.verify(token, jwtSecret);
    return users[payload.role] || users.patient;
  }

  app.get("/api/auth/me", (req, res) => {
    const row = currentUser(req);
    return res.json({
      user: formatUser(row),
      session: { actingAs: false, principal: formatUser(row) },
    });
  });
  app.get("/api/patient/profile", (_req, res) =>
    res.json({
      profile: {
        firstName: "Lila",
        lastName: "Synthetic",
        email: "lila.synthetic@example.test",
        phone: "09175551101",
        date_of_birth: "2001-06-15",
        gender: "Female",
        patientCategory: "regular",
        patientId: "A-2026-1101",
        verified: true,
        membership_tier: "Premium Patient",
        memberSince: "2026-01-10",
      },
      preferences: { theme: "light", notifyQueue: false, notifySms: true },
    })
  );
  app.get("/api/patient/security", (_req, res) => res.json({ lastLogin: "2026-11-20T01:00:00.000Z" }));
  app.get("/api/patient/catalog", (_req, res) => res.json({ hmoProviders: [] }));
  app.get("/api/patient/booking-branches", (_req, res) => res.json({ branches: [] }));
  app.get("/api/patient/notifications", (_req, res) => res.json({ notifications: [], unreadCount: 0 }));
  app.get("/api/staff/branch-context", (_req, res) =>
    res.json({ operational: true, branch: { id: 1, name: "Main" }, activeBranches: [{ id: 1, name: "Main" }] })
  );
  app.get("/api/staff/dashboard", (_req, res) => res.json({ metrics: { unreadNotifications: 0 } }));
  app.get("/api/staff/notifications", (_req, res) => res.json({ notifications: [], unreadCount: 0 }));
  app.get("/api/staff/patients", (_req, res) => res.json({ patients: [patientPayload, missingPayload] }));
  app.get("/api/staff/patients/:id/prescriptions", (_req, res) => res.json({ prescriptions: [] }));
  app.get("/api/staff/patients/:id/dental-chart", (_req, res) => res.json({ entries: [] }));
  app.get("/api/staff/patients/:id", (req, res) =>
    res.json({ patient: String(req.params.id) === "43" ? missingPayload : patientPayload, treatments: [] })
  );
  app.get("/api/dentist/branch-context", (_req, res) =>
    res.json({ operational: true, branch: { id: 1, name: "Main" }, activeBranches: [{ id: 1, name: "Main" }] })
  );
  app.get("/api/dentist/dashboard", (_req, res) => res.json({ metrics: { unreadNotifications: 0 } }));
  app.get("/api/dentist/notifications", (_req, res) => res.json({ notifications: [], unreadCount: 0 }));
  app.get("/api/dentist/profile", (_req, res) => res.json({ profile: formatUser(users.dentist) }));
  app.get("/api/dentist/patients", (_req, res) => res.json({ patients: [patientPayload, missingPayload] }));
  app.get("/api/dentist/patients/:id/medical-documents", (_req, res) => res.json({ documents: [] }));
  app.get("/api/dentist/patients/:id/prescriptions", (_req, res) => res.json({ prescriptions: [] }));
  app.get("/api/dentist/patients/:id/dental-chart", (_req, res) => res.json({ entries: [] }));
  app.get("/api/dentist/patients/:id", (req, res) =>
    res.json({
      patient: String(req.params.id) === "43" ? missingPayload : patientPayload,
      treatments: [],
      nextAppointment: null,
      access: {},
      wellness: { hasAssessment: false },
    })
  );
  app.get("/api/admin/dashboard", (_req, res) => res.json({ metrics: {} }));
  app.get("/api/admin/notifications", (_req, res) => res.json({ notifications: [], unreadCount: 0 }));
  app.get("/api/admin/clinical-records", (_req, res) =>
    res.json({ records: [patientPayload, missingPayload] })
  );
  app.get("/api/admin/clinical-records/:id", (req, res) =>
    res.json({
      record: String(req.params.id) === "43" ? missingPayload : patientPayload,
      treatments: [],
      appointments: [],
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
  fs.mkdirSync(screenshotDir, { recursive: true });
  const origin = `http://127.0.0.1:${frontendPort}`;

  async function signIn(role) {
    const token = jwt.sign({ id: String(users[role].id), role }, jwtSecret, { expiresIn: "1h" });
    await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded" });
    await page.evaluate((value) => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem("amethyst_access_token", value);
    }, token);
    return token;
  }

  async function openPatientPersonal() {
    await page.waitForFunction(() => document.body.innerText.includes("My Profile"));
    await page.evaluate(() =>
      [...document.querySelectorAll(".profile-menu__item")].find((button) =>
        /Personal Information/i.test(button.textContent || "")
      )?.click()
    );
    await page.waitForFunction(() => document.body.innerText.includes("Date of birth"));
  }

  async function shot(name) {
    const dest = path.join(screenshotDir, name);
    await page.screenshot({ path: dest, fullPage: true });
    fs.copyFileSync(dest, path.join(artifactsDir, name));
  }

  await page.setViewport({ width: 1280, height: 900 });
  await signIn("patient");
  await page.goto(`${origin}/profile`, { waitUntil: "networkidle0" });
  await openPatientPersonal();
  const patientText = await page.evaluate(() => document.body.innerText);
  assert.match(patientText, /\bSex\b/);
  assert.match(patientText, /Date of birth/);
  assert.match(patientText, /Female/);
  await shot("patient-personal-desktop.png");

  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.reload({ waitUntil: "networkidle0" });
  await openPatientPersonal();
  const overflow390 = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  );
  assert.equal(overflow390, false);
  await shot("patient-personal-390.png");

  await page.setViewport({ width: 320, height: 720, isMobile: true, hasTouch: true });
  await page.reload({ waitUntil: "networkidle0" });
  await openPatientPersonal();
  const overflow320 = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  );
  assert.equal(overflow320, false);
  await shot("patient-personal-320.png");

  await page.setViewport({ width: 1280, height: 900 });
  await signIn("staff");
  await page.goto(`${origin}/staff/patient-records`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.body.innerText.includes("Lila Synthetic"));
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((button) => /View/i.test(button.textContent || ""))?.click()
  );
  await page.waitForFunction(() => document.body.innerText.includes("Date of birth"));
  const staffText = await page.evaluate(() => document.body.innerText);
  assert.match(staffText, /Sex/);
  assert.match(staffText, /Date of birth/);
  assert.match(staffText, /Female/);
  assert.match(staffText, /June 15, 2001/);
  await shot("staff-patient-details-desktop.png");

  await signIn("dentist");
  await page.goto(`${origin}/dentist/patient-records/42`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.body.innerText.includes("Personal Information"));
  await page.evaluate(() =>
    [...document.querySelectorAll(".profile-menu__item")].find((button) =>
      /Personal Information/i.test(button.textContent || "")
    )?.click()
  );
  await page.waitForFunction(() => document.body.innerText.includes("lila.synthetic@example.test"));
  const dentistText = await page.evaluate(() => document.body.innerText);
  assert.match(dentistText, /\bSex\b/);
  assert.match(dentistText, /Date of birth/);
  assert.match(dentistText, /Female/);
  assert.match(dentistText, /June 15, 2001/);
  await shot("dentist-personal-desktop.png");

  await page.goto(`${origin}/dentist/patient-records/43`, { waitUntil: "networkidle0" });
  await page.evaluate(() =>
    [...document.querySelectorAll(".profile-menu__item")].find((button) =>
      /Personal Information/i.test(button.textContent || "")
    )?.click()
  );
  await page.waitForFunction(() => document.body.innerText.includes("Not recorded"));
  await shot("dentist-personal-not-recorded.png");

  await signIn("admin");
  await page.goto(`${origin}/admin/patient-records`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.body.innerText.includes("Lila Synthetic"));
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((button) => /View/i.test(button.textContent || ""))?.click()
  );
  await page.waitForFunction(() => document.body.innerText.includes("Date of birth"));
  const adminText = await page.evaluate(() => document.body.innerText);
  assert.match(adminText, /\bSex\b/);
  assert.match(adminText, /Date of birth/);
  assert.match(adminText, /Female/);
  assert.match(adminText, /June 15, 2001/);
  await shot("admin-patient-record-desktop.png");
});
