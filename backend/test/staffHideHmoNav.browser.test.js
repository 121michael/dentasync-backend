"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");
const dotenv = require("dotenv");
const express = require("express");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const chrome = "/usr/local/bin/google-chrome";
const artifactsDir = "/opt/cursor/artifacts";
const dbName = `ds_hide_hmo_nav_${process.pid}_${Date.now().toString(36)}`;
const adminPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || "localhost",
  database: "postgres",
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
});
process.env.DB_NAME = dbName;

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

test("Staff navigation hides HMO Verification while Patient booking still offers HMO", { timeout: 120000 }, async (t) => {
  assert.ok(fs.existsSync(chrome), "google-chrome is required for this browser check");
  await adminPool.query(`CREATE DATABASE ${dbName}`);
  const db = require("../db");
  db.on("error", () => {});
  const { resolveAppSecrets } = require("../lib/securityConfig");

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
    await db.end();
    await adminPool.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
    await adminPool.end();
  });

  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "000_create_users.sql"), "utf8"));
  await db.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS patient_id TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS patient_category TEXT;
  `);
  const staff = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Minda', 'Nav', 'staff.hidehmo@example.test', '09170001111', 'synthetic-hash', 'staff', TRUE, 'Active')
     RETURNING *`
  );
  const patient = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Pearl', 'Book', 'patient.hidehmo@example.test', '09170002222', 'synthetic-hash', 'patient', TRUE, 'Active')
     RETURNING *`
  );
  const staffRow = staff.rows[0];
  const patientRow = patient.rows[0];

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-DentaSync-Branch");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  const { jwtSecret } = resolveAppSecrets(process.env);
  function readUser(req) {
    const header = String(req.headers.authorization || "");
    const token = header.replace(/^Bearer\s+/i, "");
    const payload = jwt.verify(token, jwtSecret);
    return String(payload.role) === "staff" ? staffRow : patientRow;
  }
  app.get("/api/auth/me", (req, res) => {
    const row = readUser(req);
    return res.json({
      user: formatUser(row),
      session: { actingAs: false, actAsUserId: null, principal: formatUser(row) },
    });
  });
  app.get("/api/staff/dashboard", (_req, res) => {
    res.json({
      clinicDate: "2026-11-20",
      timezone: "Asia/Manila",
      metrics: { pendingHmoVerification: 1 },
      todaysActivity: [],
      branch: { id: 1, name: "Mandaluyong" },
    });
  });
  app.get("/api/staff/branch-context", (_req, res) => {
    res.json({
      operational: true,
      branch: { id: 1, name: "Mandaluyong" },
      activeBranches: [{ id: 1, name: "Mandaluyong" }],
    });
  });
  app.get("/api/patient/catalog", (_req, res) => {
    res.json({
      services: [
        {
          id: "consultation",
          name: "Consultation / Oral Examination",
          title: "Consultation / Oral Examination",
        },
      ],
      hmoProviders: [{ name: "Maxicare" }],
      clinicServices: [],
    });
  });
  app.get("/api/patient/appointments", (_req, res) => res.json({ appointments: [] }));
  app.get("/api/patient/dependents", (_req, res) => res.json({ dependents: [] }));
  app.get("/api/patient/dashboard", (_req, res) => res.json({ metrics: {} }));
  app.get("/api/patient/branches", (_req, res) =>
    res.json({
      legacy: false,
      requiresSelection: false,
      autoSelectedBranchId: 1,
      branches: [{ id: 1, name: "Mandaluyong" }],
    })
  );
  app.get("/api/patient/availability", (_req, res) =>
    res.json({
      closed: false,
      hours: { open: "09:00", close: "16:00" },
      availableTimes: ["09:00"],
      dateOnlyBookable: true,
      slots: [{ time: "09:00", bookable: true, period: "Morning" }],
    })
  );

  apiServer = http.createServer(app);
  await new Promise((resolve) => apiServer.listen(0, "127.0.0.1", resolve));
  const apiPort = apiServer.address().port;
  const frontendPort = 5198;
  const frontendUrl = `http://127.0.0.1:${frontendPort}`;

  vite = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(frontendPort)], {
    cwd: path.join(__dirname, "../../frontend"),
    env: { ...process.env, VITE_PROXY_API: `http://127.0.0.1:${apiPort}` },
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

  const tokenFor = (row) => jwt.sign({ id: String(row.id), role: row.role }, jwtSecret, { expiresIn: "1h" });
  const puppeteer = require("/tmp/node_modules/puppeteer-core");
  browser = await puppeteer.launch({
    executablePath: chrome,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(25000);
  fs.mkdirSync(artifactsDir, { recursive: true });

  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${frontendUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate((token) => localStorage.setItem("amethyst_access_token", token), tokenFor(staffRow));
  await page.goto(`${frontendUrl}/staff/dashboard`, { waitUntil: "networkidle0" });
  await page.waitForSelector(".staff-nav");
  const desktopNav = await page.$eval(".staff-nav", (node) => node.innerText);
  assert.match(desktopNav, /Appointments/);
  assert.match(desktopNav, /Patient Records/);
  assert.doesNotMatch(desktopNav, /HMO Verification/);
  await page.screenshot({ path: path.join(artifactsDir, "staff_desktop_sidebar_without_hmo.png"), fullPage: true });

  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector('button[aria-label="Open menu"]');
  await page.evaluate(() => document.querySelector('button[aria-label="Open menu"]')?.click());
  await page.waitForSelector(".fab-menu.is-open .fab-menu__item");
  const mobileNav = await page.$$eval(".fab-menu.is-open .fab-menu__item", (nodes) =>
    nodes.map((node) => node.textContent).join("\n")
  );
  assert.match(mobileNav, /Appointments/);
  assert.match(mobileNav, /Patient Records/);
  assert.doesNotMatch(mobileNav, /HMO Verification/);
  await page.screenshot({ path: path.join(artifactsDir, "staff_mobile_menu_without_hmo.png"), fullPage: true });

  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${frontendUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate((token) => localStorage.setItem("amethyst_access_token", token), tokenFor(patientRow));
  await page.goto(`${frontendUrl}/appointments/book`, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForFunction(() => document.body.innerText.includes("Select your service"), { timeout: 15000 });
  } catch (error) {
    const debug = await page.evaluate(() => document.body.innerText);
    throw new Error(`booking page did not load service step: ${debug.slice(0, 800)}`);
  }
  await page.evaluate(() => {
    const option = [...document.querySelectorAll(".treatment-option")].find((node) =>
      /Consultation/i.test(node.textContent || "")
    );
    option?.click();
  });
  await page.evaluate(() => document.querySelector('[aria-label="Close service details"]')?.click());
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((button) => /Continue to schedule/i.test(button.textContent || ""))?.click()
  );
  await page.waitForFunction(() => document.body.innerText.includes("Choose date and optional time"), { timeout: 10000 });
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((button) => /Continue to coverage/i.test(button.textContent || ""))?.click()
  );
  await page.waitForFunction(() => document.body.innerText.includes("Will you be using an HMO?"), { timeout: 10000 });
  const coverage = await page.evaluate(() => document.body.innerText);
  assert.match(coverage, /Yes, I have HMO coverage/);
  await page.click('input[value="hmo"]');
  const hmoSelected = await page.$eval(".coverage-option.is-selected", (node) => node.textContent);
  assert.match(hmoSelected, /Yes, I have HMO coverage/);
  await page.screenshot({ path: path.join(artifactsDir, "patient_book_appointment_hmo_option.png"), fullPage: true });
});
