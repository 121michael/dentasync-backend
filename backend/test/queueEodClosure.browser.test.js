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
const frontendPort = 5219;

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

test("Queue closure statuses and dentist Needs Review fit Amethyst layouts", { timeout: 120000 }, async (t) => {
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
  };
  const staff = {
    id: "17",
    first_name: "Minda",
    last_name: "Desk",
    email: "minda.staff@example.test",
    phone: "09170002222",
    role: "staff",
  };

  let visitStatus = "needs_review";
  const reviews = [];
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-DentaSync-Branch");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.get("/api/auth/me", (req, res) => {
    const header = String(req.headers.authorization || "");
    const token = header.replace(/^Bearer\s+/i, "");
    const payload = jwt.verify(token, jwtSecret);
    const row = String(payload.role) === "staff" ? staff : dentist;
    return res.json({ user: formatUser(row), session: { actingAs: false, principal: formatUser(row) } });
  });
  app.get("/api/dentist/branch-context", (_req, res) =>
    res.json({ operational: true, branch: { id: 1, name: "Mandaluyong" }, activeBranches: [{ id: 1, name: "Mandaluyong" }] })
  );
  app.get("/api/staff/branch-context", (_req, res) =>
    res.json({ operational: true, branch: { id: 1, name: "Mandaluyong" }, activeBranches: [{ id: 1, name: "Mandaluyong" }] })
  );
  app.get("/api/dentist/dashboard", (_req, res) => res.json({ metrics: { unreadNotifications: 0 } }));
  app.get("/api/staff/dashboard", (_req, res) =>
    res.json({ clinicDate: "2026-11-20", timezone: "Asia/Manila", metrics: {}, todaysActivity: [], branch: { id: 1, name: "Mandaluyong" } })
  );
  app.get("/api/dentist/notifications", (_req, res) => res.json({ notifications: [], unreadCount: 0 }));
  app.get("/api/staff/notifications", (_req, res) => res.json({ notifications: [], unreadCount: 0 }));
  app.get("/api/dentist/profile", (_req, res) => res.json({ profile: formatUser(dentist) }));
  app.get("/api/staff/profile", (_req, res) => res.json({ profile: formatUser(staff) }));
  app.get("/api/dentist/patients", (_req, res) => res.json({ patients: [] }));
  app.get("/api/dentist/patients/:id/medical-documents", (_req, res) => res.json({ documents: [] }));
  app.get("/api/dentist/patients/:id/prescriptions", (_req, res) => res.json({ prescriptions: [] }));
  app.get("/api/dentist/patients/:id/dental-chart", (_req, res) => res.json({ entries: [] }));
  app.post("/api/dentist/patients/:id/record-access", (_req, res) =>
    res.status(403).json({ message: "You cannot use a dentist grant from this workstation." })
  );
  app.get("/api/dentist/patients/:id", (_req, res) =>
    res.json({
      patient: {
        id: 42,
        fullName: "Pearl Amethyst",
        patientName: "Pearl Amethyst",
        patientId: "P-2026-1120",
        recordCode: "P-2026-1120",
        age: 34,
        gender: "Female",
        dateOfBirth: "1992-03-14",
        phone: "09171234888",
        email: "pearl.amethyst@example.test",
        patientCategory: "regular",
        profileLocked: true,
        linkedUserId: "77",
      },
      treatments: [],
      appointments: [],
      access: { grantExpiresAt: null },
      currentVisit: null,
      needsReviewVisits: [
        {
          queueEntryId: 88,
          appointmentId: 12,
          token: "A-003",
          status: visitStatus,
          visitDate: "2026-11-20",
          checkedInAt: "2026-11-20T02:00:00.000Z",
          procedures: [],
        },
        {
          queueEntryId: 89,
          appointmentId: 13,
          token: "A-009",
          status: "needs_review",
          visitDate: "2026-11-18",
          checkedInAt: "2026-11-18T03:00:00.000Z",
          procedures: [{ id: 1, treatment: "Cleaning / Oral Prophylaxis", status: "completed" }],
        },
      ],
      wellness: { hasAssessment: false },
    })
  );
  app.post("/api/dentist/patients/:id/queue-visits/:queueId/review", (req, res) => {
    reviews.push(req.body);
    visitStatus = req.body?.outcome === "not_served" ? "not_served" : "completed";
    return res.json({
      message: visitStatus === "completed" ? "Visit marked Completed after dentist review." : "Visit marked Not Served after dentist review.",
      visit: { queueEntryId: Number(req.params.queueId), token: "A-003", status: visitStatus },
    });
  });
  app.post("/api/dentist/patients/:id/treatments", (_req, res) =>
    res.status(201).json({ message: "Procedures saved. Dental chart updated automatically." })
  );

  const queue = [
    {
      id: 5,
      token: "A-001",
      patientName: "Pearl Amethyst",
      timestamp: "2026-11-20T02:00:00.000Z",
      status: "not_served",
      appointment: { treatment: "Cleaning", dentist: "Dr. Tala Reyes", time: "10:00" },
      checkInMethod: "qr",
      procedures: [],
    },
    {
      id: 6,
      token: "A-003",
      patientName: "Pearl Amethyst",
      timestamp: "2026-11-20T02:10:00.000Z",
      status: "needs_review",
      appointment: { treatment: "Filling", dentist: "Dr. Tala Reyes", time: "10:30" },
      checkInMethod: "rfid",
      procedures: [],
    },
    {
      id: 7,
      token: "A-004",
      patientName: "Rio Amethyst",
      timestamp: "2026-11-20T02:20:00.000Z",
      status: "completed",
      appointment: { treatment: "Cleaning", dentist: "Dr. Tala Reyes", time: "11:00" },
      checkInMethod: "manual",
      procedures: [],
    },
  ];
  app.get("/api/staff/queue/summary", (_req, res) =>
    res.json({ waiting: 0, called: 0, inTreatment: 0, completed: 1, notServed: 1, needsReview: 1 })
  );
  app.get("/api/staff/rfid-events", (_req, res) => res.json({ events: [] }));
  app.get("/api/staff/check-in/qr-session", (_req, res) => res.json({ session: null }));
  app.get("/api/staff/queue", (_req, res) => res.json({ queue, updatedAt: new Date().toISOString() }));
  app.get("/api/staff/check-ins", (_req, res) =>
    res.json({
      checkIns: queue,
      label: "November 20, 2026",
      subtitle: "Date filter",
      emptyDetail: "No check-ins",
      date: "2026-11-20",
      timezone: "Asia/Manila",
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
  page.on("dialog", (dialog) => dialog.accept());
  fs.mkdirSync(artifactsDir, { recursive: true });
  const url = `http://127.0.0.1:${frontendPort}`;

  async function signIn(role) {
    const token = jwt.sign({ id: role === "staff" ? staff.id : dentist.id, role }, jwtSecret, { expiresIn: "1h" });
    await page.goto(`${url}/login`, { waitUntil: "domcontentloaded" });
    await page.evaluate((value) => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem("amethyst_access_token", value);
    }, token);
  }

  await page.setViewport({ width: 1280, height: 1100 });
  await signIn("staff");
  await page.goto(`${url}/staff/queue`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.body.innerText.includes("Not Served"));
  const queueText = await page.evaluate(() => document.body.innerText);
  assert.match(queueText, /Needs Review/);
  assert.match(queueText, /Completed/);
  await page.screenshot({ path: path.join(artifactsDir, "queue_eod_staff_queue_desktop.png"), fullPage: true });

  await page.goto(`${url}/staff/check-in`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.body.innerText.includes("Not Served"));
  assert.match(await page.evaluate(() => document.body.innerText), /Needs Review/);
  await page.screenshot({ path: path.join(artifactsDir, "queue_eod_staff_checkin_desktop.png"), fullPage: true });

  await signIn("dentist");
  await page.goto(`${url}/dentist/patient-records/42`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.body.innerText.includes("Pearl Amethyst"));
  await page.evaluate(() =>
    [...document.querySelectorAll(".profile-menu__item")].find((button) =>
      /Clinical Information/i.test(button.textContent || "")
    )?.click()
  );
  await page.waitForFunction(() => document.body.innerText.includes("Needs Review"));
  const clinical = await page.evaluate(() => document.body.innerText);
  assert.match(clinical, /Queue A-003/);
  assert.match(clinical, /2026-11-20/);
  assert.match(clinical, /Queue A-009/);
  assert.match(clinical, /Mark Completed/);
  assert.match(clinical, /Mark Not Served/);
  await page.screenshot({ path: path.join(artifactsDir, "queue_eod_dentist_review_desktop.png"), fullPage: true });

  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((button) => /Mark Completed/i.test(button.textContent || ""))?.click()
  );
  await page.waitForFunction(() => document.body.innerText.includes("Visit marked Completed") || document.body.innerText.includes("review saved"));
  assert.ok(reviews.length >= 1);

  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(`${url}/dentist/patient-records/42`, { waitUntil: "networkidle0" });
  await page.evaluate(() =>
    [...document.querySelectorAll(".profile-menu__item")].find((button) =>
      /Clinical Information/i.test(button.textContent || "")
    )?.click()
  );
  await page.waitForFunction(() => document.body.innerText.includes("Add or verify treatment"));
  const overflow390 = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  assert.equal(overflow390, false);
  await page.screenshot({ path: path.join(artifactsDir, "queue_eod_dentist_review_390.png"), fullPage: true });

  await page.setViewport({ width: 320, height: 720, isMobile: true, hasTouch: true });
  await page.goto(`${url}/dentist/patient-records/42`, { waitUntil: "networkidle0" });
  await page.evaluate(() =>
    [...document.querySelectorAll(".profile-menu__item")].find((button) =>
      /Clinical Information/i.test(button.textContent || "")
    )?.click()
  );
  await page.waitForFunction(() => document.body.innerText.includes("Needs Review"));
  const overflow320 = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  assert.equal(overflow320, false);
  const overlap = await page.evaluate(() => {
    const fab = document.querySelector(".fab-menu__button") || document.querySelector('[aria-label="Open menu"]');
    const actions = document.querySelector(".dentist-needs-review-card__actions");
    if (!fab || !actions) return { skipped: true };
    const a = fab.getBoundingClientRect();
    const b = actions.getBoundingClientRect();
    const visible = a.width > 1 && a.height > 1 && getComputedStyle(fab).visibility !== "hidden";
    if (!visible) return { skipped: true };
    return {
      skipped: false,
      hitsActions: a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top,
    };
  });
  if (!overlap.skipped) assert.equal(overlap.hitsActions, false, JSON.stringify(overlap));
  await page.screenshot({ path: path.join(artifactsDir, "queue_eod_dentist_review_320.png"), fullPage: true });
});
