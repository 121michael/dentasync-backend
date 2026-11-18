import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(path.join(root, "index.css"), "utf8");
const page = fs.readFileSync(path.join(root, "pages", "AdminBranchesPage.jsx"), "utf8");
const modal = fs.readFileSync(path.join(root, "components", "AdminUI.jsx"), "utf8");

test("edit branch modal keeps the header title and close control", () => {
  assert.match(modal, /className = ""/);
  assert.match(modal, /aria-label=\{`Close \$\{title\}`\}/);
  assert.match(page, /title=\{editing \? "Edit branch" : "Add branch"\}/);
  assert.match(page, /className="admin-modal--branch"/);
  assert.match(page, /onClose=\{closeForm\}/);
});

test("branch fields use stacked labels, a two-column contact row, and check-in toggles", () => {
  assert.match(page, /className=\{`field\$\{error \? " field--warning" : ""\}`\}/);
  assert.match(page, /className="admin-form--branch__row"/);
  assert.match(page, /<legend>Check-in methods<\/legend>/);
  assert.match(page, /role="switch"/);
  assert.match(page, /Save branch/);
  assert.match(page, /button--secondary/);
  assert.match(css, /\.admin-form--branch__row \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test("contact and email stack at 390px and the modal stays in the viewport at 320px", () => {
  assert.match(
    css,
    /@media \(max-width: 390px\) \{[\s\S]*\.admin-form--branch__row \{[\s\S]*grid-template-columns: 1fr;/
  );
  assert.match(
    css,
    /@media \(max-width: 320px\) \{[\s\S]*\.admin-modal--branch \{[\s\S]*max-height: calc\(100dvh - 0\.7rem\);/
  );
  assert.match(css, /\.admin-form--branch \.field textarea \{[\s\S]*min-height: 96px;/);
  assert.match(css, /\.admin-form--branch \.admin-modal__actions \{[\s\S]*flex-shrink: 0;/);
});
