"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  APPROVED_HMO_PROVIDERS,
  canSaveHmoProvider,
  findAccreditedHmoByName,
  listAccreditedHmoProviders,
  publicHmoProviders,
} = require("../services/accreditedHmoProviders");

const SOURCE = [
  { id: "maxicare", name: "Maxicare", aliases: ["maxicare"], filipinoDoctors: false, active: true },
  { id: "retired", name: "RetiredCare", aliases: ["retiredcare"], filipinoDoctors: false, active: false },
];

test("accredited catalog exposes only active providers for new selections", () => {
  const names = listAccreditedHmoProviders().map((provider) => provider.name);
  assert.deepEqual(names, [
    "Maxicare",
    "iCare",
    "Pacific Cross",
    "Etiqa",
    "Lacson & Lacson",
    "HPPI",
    "Flexicare",
    "Cocolife",
    "ValuCare",
  ]);
  assert.equal(APPROVED_HMO_PROVIDERS.every((provider) => provider.active !== false), true);
  assert.equal(
    publicHmoProviders({ source: SOURCE }).map((provider) => provider.name).join(","),
    "Maxicare"
  );
  assert.equal(findAccreditedHmoByName("RetiredCare", { source: SOURCE }), null);
  assert.equal(findAccreditedHmoByName("RetiredCare", { source: SOURCE, includeInactive: true }).active, false);
});

test("patients can keep a saved inactive provider until they pick a replacement", () => {
  assert.equal(canSaveHmoProvider("Maxicare", { source: SOURCE }).ok, true);
  assert.equal(canSaveHmoProvider("RetiredCare", { source: SOURCE }).ok, false);
  assert.equal(canSaveHmoProvider("RetiredCare", { source: SOURCE, currentProvider: "RetiredCare" }).ok, true);
  assert.equal(canSaveHmoProvider("RetiredCare", { source: SOURCE, currentProvider: "RetiredCare" }).preserved, true);
  assert.equal(canSaveHmoProvider("MediCard", { source: SOURCE, currentProvider: "Maxicare" }).ok, false);
  assert.equal(canSaveHmoProvider("", { source: SOURCE }).ok, true);
});
