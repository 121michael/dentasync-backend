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
const screenshotDir = path.join(__dirname, "../../screenshots/admin-clinic-service-dropdown");
const frontendPort = 5218;

test("Admin Clinic Services uses one dropdown at 320, 390, and desktop", { timeout: 180000 }, async (t) => {
  if (!fs.existsSync(chrome)) {
    t.diagnostic("google-chrome is required");
    return;
  }
  const { jwtSecret } = resolveAppSecrets(process.env);
  const admin = {
    id: "11",
    first_name: "Ada",
    last_name: "Admin",
    email: "ada.admin@example.test",
    phone: "09170003333",
    role: "admin",
  };
  const services = [
    {
      id: "cleaning",
      group: "preventive",
      adminVisible: true,
      title: "Dental Cleaning",
      priceLabel: "₱1,000–₱1,500",
      chatbotEn: "Cleaning starts at ₱1,000.",
      details: "Do not show this official detail in the editor.",
      lines: [{ label: "Mild", value: "₱1,000" }],
    },
    {
      id: "filling",
      group: "other",
      adminVisible: true,
      title: "Permanent Filling",
      priceLabel: "₱1,000 per surface",
      chatbotEn: "Filling is ₱1,000 per surface.",
      details: "Keep filling details stored.",
      lines: [],
    },
  ];
  const groups = [
    { id: "preventive", title: "Consultation and preventive care" },
    { id: "other", title: "Other clinic services" },
  ];
  const settings = {
    amethystAiEnabled: true,
    predictiveDiagnostics: false,
    automatedReminders: false,
    waitingTimePrediction: false,
    aiChatbot: true,
    scheduledSystemUpdates: false,
    chatbotKnowledgeMode: "clinic",
    diagnosticsSensitivity: "balanced",
  };
  let saved;
  let failNextSave = false;

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
    res.json({ user: formatUser(admin), session: { actingAs: false, principal: formatUser(admin) } })
  );
  app.get("/api/admin/dashboard", (_req, res) => res.json({ metrics: {} }));
  app.get("/api/admin/notifications", (_req, res) => res.json({ notifications: [], unreadCount: 0 }));
  app.get("/api/admin/ai-settings", (_req, res) => res.json({ settings }));
  app.get("/api/admin/clinic-services", (_req, res) => res.json({ groups, services }));
  app.put("/api/admin/clinic-services", (req, res) => {
    if (failNextSave) {
      failNextSave = false;
      return res.status(500).json({ message: "Synthetic save failed." });
    }
    saved = req.body;
    const patch = req.body?.services?.[0] || {};
    const next = services.map((service) =>
      service.id === patch.id
        ? { ...service, priceLabel: patch.priceLabel, chatbotEn: patch.chatbotEn }
        : service
    );
    return res.json({ message: "Clinic services updated successfully.", groups, services: next });
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
  fs.mkdirSync(screenshotDir, { recursive: true });
  const origin = `http://127.0.0.1:${frontendPort}`;
  const token = jwt.sign({ id: String(admin.id), role: "admin" }, jwtSecret, { expiresIn: "1h" });

  async function openPage(width, height, mobile) {
    await page.setViewport({ width, height, isMobile: Boolean(mobile), hasTouch: Boolean(mobile) });
    await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded" });
    await page.evaluate((value) => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem("amethyst_access_token", value);
    }, token);
    await page.goto(`${origin}/admin/ai-settings`, { waitUntil: "networkidle0" });
    await page.waitForSelector("#admin-clinic-service-select");
    await page.$eval(".admin-clinic-services", (node) => node.scrollIntoView({ block: "center" }));
  }

  async function shot(name) {
    const dest = path.join(screenshotDir, name);
    await page.screenshot({ path: dest, fullPage: true });
    fs.copyFileSync(dest, path.join(artifactsDir, name));
  }

  await openPage(1280, 900, false);
  const desktop = await page.evaluate(() => document.body.innerText);
  assert.match(desktop, /Clinic Services/);
  assert.match(desktop, /Select a service/);
  assert.doesNotMatch(desktop, /Official price \/ details/);
  assert.doesNotMatch(desktop, /Price units and terms/);
  const saveDisabled = await page.$eval(".admin-clinic-services__form button.button--primary", (button) => button.disabled);
  assert.equal(saveDisabled, true);
  const optionValues = await page.$$eval("#admin-clinic-service-select option", (nodes) =>
    nodes.map((node) => ({ value: node.value, label: node.textContent.trim() }))
  );
  assert.equal(optionValues[0].value, "");
  assert.equal(optionValues[0].label, "Select a service");
  assert.ok(optionValues.some((item) => item.value === "cleaning" && item.label === "Dental Cleaning"));
  assert.ok(optionValues.some((item) => item.value === "filling" && item.label === "Permanent Filling"));
  await shot("admin-clinic-services-dropdown-desktop.png");

  await page.select("#admin-clinic-service-select", "cleaning");
  await page.waitForSelector("#admin-clinic-service-price");
  assert.equal(await page.$eval("#admin-clinic-service-price", (input) => input.value), "₱1,000–₱1,500");
  assert.equal(await page.$eval("#admin-clinic-service-chatbot", (input) => input.value), "Cleaning starts at ₱1,000.");
  assert.equal(
    await page.evaluate(() => document.body.innerText.includes("Do not show this official detail in the editor.")),
    false
  );
  await page.select("#admin-clinic-service-select", "filling");
  assert.equal(await page.$eval("#admin-clinic-service-price", (input) => input.value), "₱1,000 per surface");
  await page.select("#admin-clinic-service-select", "cleaning");
  await page.select("#admin-clinic-service-select", "filling");
  assert.equal(await page.$eval("#admin-clinic-service-price", (input) => input.value), "₱1,000 per surface");
  await page.click("#admin-clinic-service-price", { clickCount: 3 });
  await page.keyboard.type("₱9,999 synthetic");
  await page.select("#admin-clinic-service-select", "cleaning");
  await page.waitForSelector('[role="dialog"][aria-label="Discard unsaved edits?"]');
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Cancel")?.click()
  );
  assert.equal(await page.$eval("#admin-clinic-service-select", (input) => input.value), "filling");
  assert.equal(await page.$eval("#admin-clinic-service-price", (input) => input.value), "₱9,999 synthetic");
  await page.select("#admin-clinic-service-select", "cleaning");
  await page.waitForSelector('[role="dialog"][aria-label="Discard unsaved edits?"]');
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Discard edits")?.click()
  );
  await page.waitForFunction(() => document.querySelector("#admin-clinic-service-select")?.value === "cleaning");
  assert.equal(await page.$eval("#admin-clinic-service-price", (input) => input.value), "₱1,000–₱1,500");
  await page.select("#admin-clinic-service-select", "filling");
  await page.click("#admin-clinic-service-price", { clickCount: 3 });
  await page.keyboard.type("₱9,999 synthetic");
  await page.evaluate(() => document.querySelector(".admin-clinic-services__form button.button--primary")?.click());
  await page.waitForSelector('[role="dialog"][aria-label="Save clinic service"]');
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Save service")?.click()
  );
  await page.waitForFunction(() => document.querySelector(".admin-clinic-services__status")?.textContent === "Saved.");
  assert.equal(saved?.services?.length, 1);
  assert.equal(saved.services[0].id, "filling");
  assert.equal(saved.services[0].priceLabel, "₱9,999 synthetic");
  assert.equal(Object.prototype.hasOwnProperty.call(saved.services[0], "details"), false);
  failNextSave = true;
  await page.evaluate(() => document.querySelector(".admin-toast .icon-button")?.click());
  await page.click("#admin-clinic-service-price", { clickCount: 3 });
  await page.keyboard.type("₱8,888 should not persist");
  await page.evaluate(() => document.querySelector(".admin-clinic-services__form button.button--primary")?.click());
  await page.waitForSelector('[role="dialog"][aria-label="Save clinic service"]');
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Save service")?.click()
  );
  await page.waitForFunction(() => document.body.innerText.includes("Synthetic save failed."));
  assert.equal(await page.$eval("#admin-clinic-service-price", (input) => input.value), "₱8,888 should not persist");
  await shot("admin-clinic-services-selected-desktop.png");

  await openPage(390, 844, true);
  const overflow390 = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  );
  assert.equal(overflow390, false);
  await shot("admin-clinic-services-dropdown-390.png");

  await openPage(320, 720, true);
  const overflow320 = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  );
  assert.equal(overflow320, false);
  await shot("admin-clinic-services-dropdown-320.png");
});
