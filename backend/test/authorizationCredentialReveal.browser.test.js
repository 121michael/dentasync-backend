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
const screenshotDir = path.join(__dirname, "../../screenshots/dentist-credential-reveal");
const frontendPort = 5216;

test("Set Credential stays masked and opens Admin verification", { timeout: 180000 }, async (t) => {
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
  let encryptionAvailable = true;
  let credentialStatus = "configured";
  const dentist = {
    id: "91",
    firstName: "Dina",
    lastName: "Synthetic",
    fullName: "Dina Synthetic",
    email: "dina.synthetic@example.test",
    phone: "09170002222",
    role: "dentist",
    status: "active",
    specialization: "General Dentistry",
    authorizationCredentialStatus: "configured",
    credentialConfigured: true,
    credentialViewable: true,
    setupRequired: false,
    branches: [{ id: 1, name: "Main" }],
  };

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
  app.get("/api/admin/branches", (_req, res) => res.json({ branches: [{ id: 1, name: "Main", status: "active" }] }));
  app.get("/api/admin/dentists/:id/authorization-credential", (_req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    return res.json({
      dentist: {
        id: dentist.id,
        authorizationCredentialStatus: credentialStatus,
        credentialConfigured: credentialStatus === "configured",
        credentialViewable: credentialStatus === "configured",
        encryptionAvailable,
      },
    });
  });
  app.put("/api/admin/dentists/:id/authorization-credential", (req, res) => {
    if (String(req.body?.password || "") !== String(req.body?.confirmPassword || "")) {
      return res.status(400).json({ message: "Authorization password and confirmation do not match." });
    }
    credentialStatus = "configured";
    return res.json({
      message: "Credential configured.",
      dentist: {
        id: dentist.id,
        authorizationCredentialStatus: "configured",
        credentialConfigured: true,
        credentialViewable: true,
        encryptionAvailable,
      },
    });
  });
  app.patch("/api/admin/dentists/:id", (_req, res) =>
    res.json({
      dentist: {
        ...dentist,
        lastName: "Updated",
        authorizationCredentialStatus: credentialStatus,
        credentialConfigured: credentialStatus === "configured",
        encryptionAvailable,
      },
    })
  );
  app.get("/api/admin/dentists", (_req, res) => res.json({ dentists: [dentist] }));
  app.get("/api/admin/staff", (_req, res) => res.json({ staff: [] }));
  app.get("/api/admin/registrations/pending", (_req, res) => res.json({ requests: [] }));
  app.get("/api/admin/registrations/rejected", (_req, res) => res.json({ requests: [] }));
  app.post("/api/admin/dentists/:id/authorization-credential/verify-view", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    return res.status(401).json({ message: "Administrator password is incorrect." });
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

  async function openCredential(width, height, mobile, { expectMask = true } = {}) {
    await page.setViewport({ width, height, isMobile: Boolean(mobile), hasTouch: Boolean(mobile) });
    await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded" });
    await page.evaluate((value) => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem("amethyst_access_token", value);
    }, token);
    await page.goto(`${origin}/admin/users?tab=dentist`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => document.body.innerText.includes("Dina Synthetic"));
    await page.evaluate(() => {
      const row = [...document.querySelectorAll("tr")].find((item) =>
        /Dina Synthetic/i.test(item.textContent || "")
      );
      [...(row?.querySelectorAll("button") || [])].find((button) => /Edit/i.test(button.textContent || ""))?.click();
    });
    await page.waitForFunction(() => document.body.innerText.includes("Set Credential"));
    if (expectMask) {
      const maskReady = await page.waitForSelector('input[data-credential-mask="true"]', { timeout: 8000 }).catch(async () => {
        t.diagnostic(await page.evaluate(() => document.querySelector(".admin-set-credential")?.innerText || document.body.innerText.slice(0, 1500)));
        return null;
      });
      if (!maskReady) {
        throw new Error("masked credential input did not render");
      }
    } else {
      await page.waitForFunction(() => /Not configured|temporarily unavailable/i.test(document.body.innerText));
    }
    await page.$eval(".admin-set-credential", (node) => node.scrollIntoView({ block: "center" }));
  }

  async function shot(name) {
    const dest = path.join(screenshotDir, name);
    await page.screenshot({ path: dest, fullPage: true });
    fs.copyFileSync(dest, path.join(artifactsDir, name));
  }

  await openCredential(1280, 900, false);
  const desktop = await page.evaluate(() => document.body.innerText);
  assert.match(desktop, /Edit Dentist/);
  assert.match(desktop, /Set Credential/);
  assert.match(desktop, /Credential set/);
  assert.match(desktop, /Save dentist details/);
  assert.match(desktop, /Reset credential/);
  assert.match(desktop, /Revoke credential/);
  assert.doesNotMatch(desktop, /\$2[aby]\$/);
  assert.doesNotMatch(desktop, /dscred1/);
  const maskValue = await page.$eval('input[data-credential-mask="true"]', (input) => input.value);
  assert.equal(maskValue, "••••••••");
  const layout = await page.evaluate(() => {
    const dialog = document.querySelector(".admin-modal--manage-user");
    const body = document.querySelector(".admin-form--manage-user__body");
    const footer = document.querySelector(".admin-form--manage-user .admin-modal__actions");
    const checkbox = document.querySelector(".admin-license-verify input[type='checkbox']");
    const label = document.querySelector(".admin-license-verify");
    const dialogBox = dialog?.getBoundingClientRect();
    const footerBox = footer?.getBoundingClientRect();
    return {
      dialogCentered: Boolean(dialogBox && Math.abs((window.innerWidth - dialogBox.width) / 2 - dialogBox.left) < 24),
      bodyScrollable: Boolean(body && getComputedStyle(body).overflowY !== "visible"),
      footerBelowBody: Boolean(footerBox && body && footerBox.top >= body.getBoundingClientRect().bottom - 2),
      checkboxBesideLabel: Boolean(
        checkbox && label && Math.abs(checkbox.getBoundingClientRect().left - label.getBoundingClientRect().left) < 8
      ),
    };
  });
  assert.equal(layout.dialogCentered, true);
  assert.equal(layout.bodyScrollable, true);
  assert.equal(layout.footerBelowBody, true);
  assert.equal(layout.checkboxBesideLabel, true);
  await shot("admin-set-credential-desktop.png");

  await page.click('button[aria-label="View authorization password"]');
  await page.waitForFunction(() => document.body.innerText.includes("Verify administrator"));
  await shot("admin-verify-credential-desktop.png");
  await page.click('button[aria-label="Close Verify administrator"]');
  await page.waitForFunction(() => !document.body.innerText.includes("Verify administrator"));
  const stillMasked = await page.$eval('input[data-credential-mask="true"]', (input) => input.value);
  assert.equal(stillMasked, "••••••••");

  await openCredential(390, 844, true);
  const overflow390 = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  );
  assert.equal(overflow390, false);
  await shot("admin-set-credential-390.png");

  await openCredential(320, 720, true);
  const overflow320 = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  );
  assert.equal(overflow320, false);
  await shot("admin-set-credential-320.png");

  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((button) => /Reset credential/i.test(button.textContent || ""))?.click();
  });
  await page.waitForFunction(() => document.body.innerText.includes("Save new credential"));
  await page.type('input[autocomplete="new-password"]', "ShortPwd1");
  const confirm = await page.$$('input[autocomplete="new-password"]');
  if (confirm[1]) await confirm[1].type("DifferentPwd9");
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((button) => /Save new credential/i.test(button.textContent || ""))?.click();
  });
  await page.waitForFunction(() =>
    /at least 10 characters|do not match/i.test(document.body.innerText)
  );
  await page.evaluate(() => {
    document.querySelector(".admin-set-credential")?.scrollIntoView({ block: "end" });
    [...document.querySelectorAll(".admin-form--manage-user__error")]
      .at(-1)
      ?.scrollIntoView({ block: "center" });
  });
  await shot("admin-set-credential-mismatch-320.png");

  encryptionAvailable = false;
  credentialStatus = "none";
  await openCredential(390, 844, true, { expectMask: false });
  const unavailable = await page.evaluate(() => document.body.innerText);
  assert.match(unavailable, /Not configured/);
  assert.match(unavailable, /temporarily unavailable/);
  assert.match(unavailable, /Save dentist details/);
  assert.doesNotMatch(unavailable, /Save credential/);
  await shot("admin-set-credential-unavailable-390.png");
});
