"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("path");
const { spawn } = require("node:child_process");
const test = require("node:test");
const express = require("express");

const chrome = "/usr/local/bin/google-chrome";
const artifactsDir = "/opt/cursor/artifacts";
const screenshotDir = path.join(__dirname, "../../screenshots/patient-register-sex-dob");
const frontendPort = 5211;

test("Create Your Account sex and date of birth layout at 320, 390, and desktop", { timeout: 120000 }, async (t) => {
  if (!fs.existsSync(chrome)) {
    t.diagnostic("google-chrome is required");
    return;
  }

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.post("/api/auth/register", (_req, res) => res.status(201).json({ requiresOtp: true, requestId: "demo" }));

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
  const url = `http://127.0.0.1:${frontendPort}/register`;

  async function measure(width, height, filename) {
    await page.setViewport({ width, height, isMobile: width <= 390, hasTouch: width <= 390 });
    await page.goto(url, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => document.body.innerText.includes("Create Your Account"));
    const info = await page.evaluate(() => {
      const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
      const row = document.querySelector(".auth-demographics-row");
      const dateInput = document.querySelector('input[name="dateOfBirth"]');
      const sex = document.querySelector('select[name="sex"]');
      const columns = row ? getComputedStyle(row).gridTemplateColumns.split(" ").filter(Boolean).length : 0;
      const dateBox = dateInput ? dateInput.getBoundingClientRect() : null;
      const panel = document.querySelector(".auth-screen__panel");
      const panelBox = panel ? panel.getBoundingClientRect() : null;
      return {
        overflow,
        columns,
        hasSelectSex: Boolean(sex && [...sex.options].some((option) => option.textContent === "Select sex" && !option.value)),
        dateFits: Boolean(dateBox && panelBox && dateBox.right <= panelBox.right + 1),
        labels: [...document.querySelectorAll(".auth-card .field > span")].map((node) => node.textContent),
      };
    });
    const dest = path.join(screenshotDir, filename);
    await page.screenshot({ path: dest, fullPage: true });
    fs.copyFileSync(dest, path.join(artifactsDir, filename));
    return info;
  }

  const desktop = await measure(1280, 900, "register-sex-dob-desktop.png");
  assert.equal(desktop.overflow, false);
  assert.equal(desktop.columns, 2);
  assert.equal(desktop.hasSelectSex, true);
  assert.equal(desktop.dateFits, true);
  assert.ok(desktop.labels.includes("Sex"));
  assert.ok(desktop.labels.includes("Date of birth"));
  const mobileIdx = desktop.labels.indexOf("Mobile number");
  const sexIdx = desktop.labels.indexOf("Sex");
  const categoryIdx = desktop.labels.indexOf("Patient category");
  assert.ok(mobileIdx >= 0 && sexIdx > mobileIdx && categoryIdx > sexIdx);

  const nativeRequired = await page.evaluate(() => {
    const sex = document.querySelector('select[name="sex"]');
    const dob = document.querySelector('input[name="dateOfBirth"]');
    return {
      sexRequired: Boolean(sex?.required),
      dobRequired: Boolean(dob?.required),
      sexValid: sex ? sex.checkValidity() : false,
      dobValid: dob ? dob.checkValidity() : false,
    };
  });
  assert.equal(nativeRequired.sexRequired, true);
  assert.equal(nativeRequired.dobRequired, true);
  assert.equal(nativeRequired.sexValid, false);
  assert.equal(nativeRequired.dobValid, false);

  const phone = await measure(390, 844, "register-sex-dob-390.png");
  assert.equal(phone.overflow, false);
  assert.equal(phone.columns, 1);
  assert.equal(phone.dateFits, true);

  const narrow = await measure(320, 720, "register-sex-dob-320.png");
  assert.equal(narrow.overflow, false);
  assert.equal(narrow.columns, 1);
  assert.equal(narrow.dateFits, true);
});
