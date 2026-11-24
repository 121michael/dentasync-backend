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

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const chrome = "/usr/local/bin/google-chrome";
const artifactsDir = "/opt/cursor/artifacts";
const frontendPort = 5228;

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

test("Patient booking requires branch and coverage before compact service cards", { timeout: 180000 }, async (t) => {
  assert.ok(fs.existsSync(chrome), "google-chrome is required");
  const { resolveAppSecrets } = require("../lib/securityConfig");
  const { jwtSecret } = resolveAppSecrets(process.env);
  const patient = {
    id: "81",
    first_name: "Pearl",
    last_name: "Booking",
    email: "pearl.booking@example.test",
    phone: "09170008881",
    role: "patient",
  };

  let catalogFail = false;
  let lastAvailabilityBranch = null;
  const availabilityByBranch = {
    1: ["09:00", "09:30"],
    2: ["14:00"],
  };
  const created = [];

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-DentaSync-Branch");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.get("/api/auth/me", (_req, res) =>
    res.json({ user: formatUser(patient), session: { actingAs: false, principal: formatUser(patient) } })
  );
  app.get("/api/patient/profile", (_req, res) =>
    res.json({
      profile: {
        hmo_provider: "Maxicare",
        hmo_member_number: "MC-4411",
        date_of_birth: "1992-03-14",
      },
    })
  );
  app.get("/api/patient/catalog", (_req, res) => {
    if (catalogFail) return res.status(503).json({ message: "Catalog temporarily unavailable." });
    return res.json({
      services: [
        {
          id: "cleaning",
          name: "Dental Cleaning / Oral Prophylaxis",
          description: "Professional dental cleaning helps remove plaque.",
          estimatedCost: 1500,
        },
        {
          id: "filling",
          name: "Permanent Filling / Restoration",
          description: "Permanent filling and restoration.",
          estimatedCost: 2500,
        },
      ],
      hmoProviders: [
        { id: "maxicare", name: "Maxicare", filipinoDoctors: false },
        { id: "icare", name: "iCare", filipinoDoctors: true },
      ],
      clinicServices: [],
      medicalDocumentTypes: [],
    });
  });
  app.get("/api/patient/appointments", (_req, res) => res.json({ appointments: [] }));
  app.get("/api/patient/dependents", (_req, res) => res.json({ dependents: [] }));
  app.get("/api/patient/notifications", (_req, res) => res.json({ notifications: [], unreadCount: 0 }));
  app.get("/api/patient/dashboard", (_req, res) =>
    res.json({
      patient: formatUser(patient),
      nextAppointment: null,
      metrics: {},
      wellness: { hasAssessment: false },
      queue: null,
      queueBoard: { entries: [] },
      unreadNotifications: 0,
      recentNotifications: [],
      smsPreferences: { notifySms: true },
    })
  );
  app.get("/api/patient/branches", (_req, res) =>
    res.json({
      requiresSelection: true,
      autoSelectedBranchId: null,
      branches: [
        { id: 1, name: "Mandaluyong", isMain: true },
        { id: 2, name: "Taguig", isMain: false },
      ],
    })
  );
  app.get("/api/patient/availability", (req, res) => {
    const branchId = String(req.query.branchId || "");
    lastAvailabilityBranch = branchId;
    const times = availabilityByBranch[branchId] || [];
    return res.json({
      closed: false,
      hours: { open: "09:00", close: "16:00" },
      availableTimes: times,
      dateOnlyBookable: true,
      branch: { id: Number(branchId) || null, name: branchId === "2" ? "Taguig" : "Mandaluyong" },
      slots: times.map((time) => ({
        time,
        bookable: true,
        period: time.startsWith("09") ? "Morning" : "Afternoon",
      })),
    });
  });
  app.post("/api/patient/appointments", (req, res) => {
    const body = req.body || {};
    if (!body.branchId) return res.status(400).json({ message: "Select a branch." });
    if (body.coverageType !== "self_pay" && body.coverageType !== "hmo") {
      return res.status(400).json({ message: "Please choose a coverage option." });
    }
    if (body.coverageType === "hmo" && (!body.hmoProvider || !body.hmoMemberNumber || !body.hmoCompanyName || !body.hmoBirthDate)) {
      return res.status(400).json({ message: "HMO details are required." });
    }
    if (!body.serviceId && !(Array.isArray(body.serviceIds) && body.serviceIds.length)) {
      return res.status(400).json({ message: "Please select a treatment." });
    }
    created.push(body);
    return res.status(201).json({
      appointment: {
        id: created.length,
        treatment: "Dental Cleaning / Oral Prophylaxis",
        date: body.appointmentDate,
        status: "pending",
        coverageType: body.coverageType,
        branchId: body.branchId,
      },
    });
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
  const url = `http://127.0.0.1:${frontendPort}`;
  await page.goto(`${url}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate((token) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("amethyst_access_token", token);
  }, jwt.sign({ id: patient.id, role: "patient" }, jwtSecret, { expiresIn: "1h" }));

  async function overflow() {
    return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  }

  await page.setViewport({ width: 1280, height: 1100 });
  await page.goto(`${url}/appointments/book`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.body.innerText.includes("Select your branch and coverage"));
  assert.match(await page.evaluate(() => document.body.innerText), /01 — Branch and Coverage/i);
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((button) => /Continue to services/i.test(button.textContent || ""))?.click()
  );
  await page.waitForFunction(() => document.body.innerText.includes("Select a branch"));
  await page.screenshot({ path: path.join(artifactsDir, "book_branch_coverage_incomplete_desktop.png"), fullPage: true });

  await page.select('select[name="branchId"]', "1");
  await page.click('input[value="self_pay"]');
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((button) => /Continue to services/i.test(button.textContent || ""))?.click()
  );
  await page.waitForFunction(() => document.body.innerText.includes("Dental Cleaning"));
  assert.match(await page.evaluate(() => document.body.innerText), /0\/3 selected/);
  assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /HMO-covered|covered by HMO/i);
  await page.screenshot({ path: path.join(artifactsDir, "book_services_selfpay_desktop.png"), fullPage: true });

  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((button) => /^Back$/i.test(button.textContent?.trim() || ""))?.click()
  );
  await page.waitForFunction(() => document.body.innerText.includes("Without HMO"));
  await page.click('input[value="hmo"]');
  await page.waitForFunction(() => document.body.innerText.includes("Using HMO details saved on your profile"));
  await page.type('input[name="hmoCompanyName"]', "Acme Dental");
  catalogFail = true;
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((button) => /Continue to services/i.test(button.textContent || ""))?.click()
  );
  await page.waitForFunction(() => document.body.innerText.includes("Select up to three services"));
  await page.evaluate(() =>
    [...document.querySelectorAll(".booking-section:not([hidden]) button")].find((button) =>
      /^Retry$/i.test(button.textContent?.trim() || "")
    )?.click()
  );
  await page.waitForFunction(() =>
    document.body.innerText.includes("temporarily unavailable") || document.body.innerText.includes("Unable to load clinic services")
  );
  catalogFail = false;
  await page.evaluate(() =>
    [...document.querySelectorAll(".booking-section:not([hidden]) button")].find((button) =>
      /^Retry$/i.test(button.textContent?.trim() || "")
    )?.click()
  );
  await page.waitForFunction(() => [...document.querySelectorAll(".treatment-option")].length >= 1);
  await page.evaluate(() => document.querySelector(".treatment-option")?.click());
  await page.evaluate(() => document.querySelector('[aria-label="Close service details"]')?.click());
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((button) => /Continue to schedule/i.test(button.textContent || ""))?.click()
  );
  await page.waitForFunction(() => document.body.innerText.includes("Choose date and optional time"));
  await page.waitForFunction(() => document.body.innerText.includes("9:00 AM") || document.body.innerText.includes("09:00"));
  await page.evaluate(() =>
    [...document.querySelectorAll(".time-slot")].find((button) => /9:00/.test(button.textContent || ""))?.click()
  );
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((button) => /Review confirmation/i.test(button.textContent || ""))?.click()
  );
  await page.waitForFunction(() => document.body.innerText.includes("Visit Summary"));
  await page.screenshot({ path: path.join(artifactsDir, "book_confirmation_desktop.png"), fullPage: true });
  await page.evaluate(() => document.querySelector('[aria-label="Close visit summary"]')?.click());
  await page.evaluate(() =>
    [...document.querySelectorAll(".booking-section:not([hidden]) button")].find((button) =>
      /^Back$/i.test(button.textContent?.trim() || "")
    )?.click()
  );
  await page.waitForFunction(() => document.body.innerText.includes("Select up to three services"));
  await page.evaluate(() =>
    [...document.querySelectorAll(".booking-section:not([hidden]) button")].find((button) =>
      /^Back$/i.test(button.textContent?.trim() || "")
    )?.click()
  );
  await page.waitForSelector('select[name="branchId"]');
  await page.select('select[name="branchId"]', "2");
  await page.waitForFunction(() => document.body.innerText.includes("Appointment time was cleared"));
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((button) => /Continue to services/i.test(button.textContent || ""))?.click()
  );
  await page.waitForFunction(() => document.body.innerText.includes("Dental Cleaning"));
  await page.evaluate(() => {
    if (!document.querySelector(".treatment-option.is-selected")) {
      document.querySelector(".treatment-option")?.click();
    }
  });
  await page.evaluate(() => document.querySelector('[aria-label="Close service details"]')?.click());
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((button) => /Continue to schedule/i.test(button.textContent || ""))?.click()
  );
  await page.waitForFunction(() => document.body.innerText.includes("Choose date and optional time"));
  await page.evaluate(() =>
    [...document.querySelectorAll(".filter-pill")].find((button) => /Afternoon/i.test(button.textContent || ""))?.click()
  );
  await page.waitForFunction(() => /2:00|14:00|Afternoon/.test(document.body.innerText));
  assert.equal(lastAvailabilityBranch, "2");
  await page.screenshot({ path: path.join(artifactsDir, "book_schedule_taguig_desktop.png"), fullPage: true });

  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(`${url}/appointments/book`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.body.innerText.includes("Select a branch"));
  assert.equal(await overflow(), false);
  await page.screenshot({ path: path.join(artifactsDir, "book_branch_coverage_390.png"), fullPage: true });

  await page.setViewport({ width: 320, height: 720, isMobile: true, hasTouch: true });
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.body.innerText.includes("Branch and Coverage"));
  assert.equal(await overflow(), false);
  await page.screenshot({ path: path.join(artifactsDir, "book_branch_coverage_320.png"), fullPage: true });
});
