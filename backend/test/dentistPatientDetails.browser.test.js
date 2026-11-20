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
const frontendPort = 5204;

test("Dentist Patient Details matches profile styling at 320, 390, and desktop", { timeout: 120000 }, async (t) => {
  assert.ok(fs.existsSync(chrome), "google-chrome is required");
  const { resolveAppSecrets } = require("../lib/securityConfig");
  const { jwtSecret } = resolveAppSecrets(process.env);

  const dentist = {
    id: "91",
    first_name: "Tala",
    last_name: "Reyes",
    email: "tala.dentist@example.test",
    phone: "09170001111",
    role: "dentist",
    status: "Active",
  };
  const savedTreatments = [];
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
    res.json({ user: formatUser(dentist), session: { actingAs: false, principal: formatUser(dentist) } })
  );
  app.get("/api/dentist/branch-context", (_req, res) =>
    res.json({ operational: true, branch: { id: 2, name: "Taguig" }, activeBranches: [{ id: 2, name: "Taguig" }] })
  );
  app.get("/api/dentist/dashboard", (_req, res) => res.json({ metrics: { unreadNotifications: 0 } }));
  app.get("/api/dentist/notifications", (_req, res) => res.json({ notifications: [], unreadCount: 0 }));
  app.get("/api/dentist/profile", (_req, res) => res.json({ profile: formatUser(dentist) }));
  app.get("/api/dentist/patients/:id/medical-documents", (_req, res) =>
    res.json({
      documents: [
        {
          id: 5,
          name: "HMO endorsement",
          filename: "endorsement.pdf",
          uploadedAt: "2026-11-02T02:00:00.000Z",
          status: "reviewed",
          reviewedByName: "Dr. Tala Reyes",
          appointment: { service: "Filling", date: "2026-10-18" },
        },
      ],
    })
  );
  app.get("/api/dentist/patients/:id/prescriptions", (_req, res) =>
    res.json({
      prescriptions: [
        { id: 3, prescriptionNumber: "RX-10021", workflowStatus: "authorized", currentVersion: 1, emailStatus: "sent" },
      ],
    })
  );
  app.get("/api/dentist/patients/:id/dental-chart", (_req, res) =>
    res.json({ entries: [{ toothNumber: "26", condition: ["filled"], treatments: ["Composite Filling"], status: "restored" }] })
  );
  app.get("/api/dentist/patients", (_req, res) => res.json({ patients: [] }));
  app.get("/api/dentist/patients/:id", (_req, res) =>
    res.json({
      patient: {
        id: 42,
        fullName: "Pearl Amethyst",
        patientName: "Pearl Amethyst",
        patientId: "P-2026-1104",
        recordCode: "P-2026-1104",
        age: 34,
        gender: "Female",
        dateOfBirth: "1992-03-14",
        phone: "09171234888",
        email: "pearl.amethyst@example.test",
        patientCategory: "regular",
        emergencyContactName: "Rio Amethyst",
        emergencyContactRelationship: "Spouse",
        emergencyContactPhone: "09179876543",
        allergies: "Penicillin",
        existingConditions: "Mild hypertension",
        currentMedications: "None",
        dentalConcerns: "Sensitivity on upper left",
        hmoStatus: "verified",
        hmoProvider: "Maxicare",
        hmoVerifiedAt: "2026-11-02",
        profileLocked: true,
        linkedUserId: "77",
        nextAppointmentDate: "2026-12-04",
        nextAppointmentTime: "10:30",
      },
      treatments: [
        {
          id: 11,
          date: "2026-10-18",
          treatmentDate: "2026-10-18",
          originatingBranchName: "Taguig",
          toothNumber: "26",
          name: "Composite Filling",
          status: "completed",
          diagnosis: "Occlusal caries",
          dentist: "Dr. Tala Reyes",
          amountCharged: 3500,
          amountPaid: 3500,
        },
      ],
      nextAppointment: { date: "2026-12-04", time: "10:30" },
      access: { grantExpiresAt: null },
      wellness: {
        hasAssessment: true,
        oralHealthScore: 82,
        assessmentDate: "2026-10-18",
        clinicalNotes: "Good home care.",
        lastCleaning: "2026-08-12",
        nextCheckup: "2026-12-04",
      },
    })
  );
  app.post("/api/dentist/patients/:id/treatments", (req, res) => {
    savedTreatments.push(req.body);
    return res.status(201).json({ message: "Treatment saved.", treatment: { id: 99, ...req.body, status: "completed" } });
  });
  app.post("/api/dentist/patients/:id/record-access", (_req, res) =>
    res.status(403).json({ message: "You cannot use a dentist grant from this workstation." })
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
  const token = jwt.sign({ id: String(dentist.id), role: "dentist" }, jwtSecret, { expiresIn: "1h" });
  const url = `http://127.0.0.1:${frontendPort}`;

  async function openRecord() {
    await page.goto(`${url}/login`, { waitUntil: "domcontentloaded" });
    await page.evaluate((value) => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem("amethyst_access_token", value);
    }, token);
    await page.goto(`${url}/dentist/patient-records/42`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => document.body.innerText.includes("Pearl Amethyst"));
  }

  await page.setViewport({ width: 1280, height: 1100 });
  await openRecord();
  const desktopText = await page.evaluate(() => document.body.innerText);
  assert.match(desktopText, /P-2026-1104/);
  assert.match(desktopText, /Back to Patient Records/);
  assert.match(desktopText, /Personal Information/);
  assert.match(desktopText, /Emergency Contact/);
  assert.match(desktopText, /Clinical Information/);
  assert.match(desktopText, /Coverage and Wellness/);
  assert.match(desktopText, /Request Record Access/);
  assert.doesNotMatch(desktopText, /RX-10021/);
  const desktopCols = await page.evaluate(() => {
    const menu = document.querySelector(".profile-menu");
    return menu ? getComputedStyle(menu).gridTemplateColumns.split(" ").length : 0;
  });
  assert.equal(desktopCols, 2);

  await page.evaluate(() =>
    [...document.querySelectorAll(".profile-menu__item")].find((button) =>
      /Personal Information/i.test(button.textContent || "")
    )?.click()
  );
  await page.waitForFunction(() => document.body.innerText.includes("pearl.amethyst@example.test"));
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((button) => /Back to patient cards/i.test(button.textContent || ""))?.click()
  );
  await page.waitForSelector(".profile-menu");

  await page.evaluate(() =>
    [...document.querySelectorAll(".profile-menu__item")].find((button) =>
      /Emergency Contact/i.test(button.textContent || "")
    )?.click()
  );
  await page.waitForFunction(() => document.body.innerText.includes("Rio Amethyst"));
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((button) => /Back to patient cards/i.test(button.textContent || ""))?.click()
  );

  await page.evaluate(() =>
    [...document.querySelectorAll(".profile-menu__item")].find((button) =>
      /Clinical Information/i.test(button.textContent || "")
    )?.click()
  );
  await page.waitForFunction(() => document.body.innerText.includes("Add Treatment"));

  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((button) => /Add Treatment/i.test(button.textContent || ""))?.click()
  );
  await page.waitForSelector(".dentist-treatment-form.is-open");
  await page.select(".procedure-draft.is-active select", "Cleaning / Oral Prophylaxis");
  await page.evaluate(() => {
    const date = document.querySelector('.procedure-draft.is-active input[type="date"]');
    if (date) {
      date.value = "2026-11-20";
      date.dispatchEvent(new Event("input", { bubbles: true }));
      date.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((button) => /Save All Procedures/i.test(button.textContent || ""))?.click()
  );
  await page.waitForFunction(() => document.body.innerText.includes("Treatment saved") || document.body.innerText.includes("Procedures saved"), { timeout: 8000 }).catch(() => {});
  assert.ok(savedTreatments.length >= 1, `treatment save should POST, got ${savedTreatments.length}`);

  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((button) => /Request Record Access/i.test(button.textContent || ""))?.click()
  );
  await page.waitForFunction(() => document.body.innerText.includes("License Number"));
  await page.screenshot({ path: path.join(artifactsDir, "dentist_patient_details_after_record_access_modal.png") });
  await page.click('button[aria-label="Close Request Record Access"]');

  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((button) => /Dental Documents|Open folder/i.test(button.textContent || ""))?.click()
  );
  await page.waitForFunction(() => document.body.innerText.includes("endorsement.pdf"));
  assert.match(await page.evaluate(() => document.body.innerText), /RX-10021/);

  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((button) => /Back to patient cards/i.test(button.textContent || ""))?.click()
  );
  await page.evaluate(() =>
    [...document.querySelectorAll(".profile-menu__item")].find((button) =>
      /Coverage and Wellness/i.test(button.textContent || "")
    )?.click()
  );
  await page.waitForFunction(() => document.body.innerText.includes("Maxicare"));

  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await openRecord();
  const overlap = await page.evaluate(() => {
    const fab = document.querySelector(".fab-menu__button") || document.querySelector('[aria-label="Open menu"]');
    const toolbar = document.querySelector(".dentist-record-toolbar");
    const heading = [...document.querySelectorAll(".profile-menu__copy strong")].find(
      (node) => node.textContent === "Personal Information"
    );
    const fields = [...document.querySelectorAll(".dentist-patient-record .profile-menu__item")];
    const buttons = [...document.querySelectorAll(".dentist-record-toolbar .button")];
    if (!fab) return { hidden: true, hitsToolbar: false, hitsHeading: false, hitsFields: [], hitsButtons: false };
    const a = fab.getBoundingClientRect();
    const visible = a.width > 1 && a.height > 1 && getComputedStyle(fab).visibility !== "hidden";
    if (!visible) {
      return { hidden: true, hitsToolbar: false, hitsHeading: false, hitsFields: [], hitsButtons: false };
    }
    const overlaps = (el) => {
      if (!el) return false;
      const b = el.getBoundingClientRect();
      return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    };
    return {
      hidden: false,
      hitsToolbar: overlaps(toolbar),
      hitsHeading: overlaps(heading),
      hitsButtons: buttons.some((button) => overlaps(button)),
      hitsFields: fields.filter((field) => overlaps(field)).map((field) => field.querySelector("span")?.textContent || ""),
      fab: { left: a.left, right: a.right, top: a.top, bottom: a.bottom },
    };
  });
  assert.equal(overlap.hitsToolbar, false, JSON.stringify(overlap));
  assert.equal(overlap.hitsHeading, false, JSON.stringify(overlap));
  assert.equal(overlap.hitsButtons, false, JSON.stringify(overlap));
  assert.deepEqual(overlap.hitsFields, [], JSON.stringify(overlap));

  await page.setViewport({ width: 320, height: 720, isMobile: true, hasTouch: true });
  await openRecord();
  const stacked = await page.evaluate(() => {
    const menu = document.querySelector(".profile-menu");
    const style = menu ? getComputedStyle(menu) : null;
    return style ? style.gridTemplateColumns.split(" ").length : 0;
  });
  assert.equal(stacked, 1);
});
