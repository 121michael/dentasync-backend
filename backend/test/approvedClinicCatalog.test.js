"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  applyOverrides,
  resolveCatalog,
  invalidateClinicCatalogCache,
  loadApprovedClinicCatalog,
} = require("../services/approvedClinicCatalog");
const { answerFromCatalog, APPROVED_CLINIC_SERVICES } = require("../services/clinicAssistant");
const { SERVICES, DENTISTS } = require("../routes/patientPortal");

test("default catalog includes official clinic prices and keeps retainer plans distinct", () => {
  const catalog = resolveCatalog(null).catalog;
  const byId = Object.fromEntries(catalog.services.map((item) => [item.id, item]));
  assert.match(byId.cleaning.details, /₱1,000–₱1,500/);
  assert.match(byId.cleaning.details, /₱2,000–₱2,500/);
  assert.match(byId.cleaning.details, /₱4,000 and above/);
  assert.equal(byId.filling.priceLabel, "₱1,000 per surface");
  assert.equal(byId.extraction.priceLabel, "₱1,500–₱5,000");
  assert.equal(byId.frenectomy.priceLabel, "₱5,000");
  assert.equal(byId["gum-contouring"].priceLabel, "₱1,000 per tooth");
  assert.match(byId.dentures.details, /₱7,500–₱30,000, depending on type and materials/);
  assert.match(byId["clear-retainer-plan"].title, /Monthly Arrangement/i);
  assert.equal(byId["invisible-retainer"].priceLabel, "₱5,000 per upper or lower retainer");
  assert.notEqual(byId["clear-retainer-plan"].id, byId["invisible-retainer"].id);
  assert.ok(APPROVED_CLINIC_SERVICES.some((item) => item.id === "frenectomy"));
  assert.equal(byId["root-canal"].priceLabel, "₱5,000 per canal");
  assert.equal(byId["dental-implants"].priceLabel, "₱100,000");
  assert.equal(byId["ortho-adjustment"].title, "Ortho Adjustment");
  assert.doesNotMatch(byId["ortho-adjustment"].priceLabel, /₱\d/);
  assert.equal(byId["fixed-bridge"].title, "Fixed Bridge / Dental Crowns");
  assert.equal(byId["dental-crowns"].adminVisible, false);
  assert.equal(byId.odontectomy.group, "oral-surgery");
  assert.equal(byId.frenectomy.group, "oral-surgery");
  assert.equal(byId.extraction.group, "surgery");
});

test("unknown service ids and html are ignored when applying admin edits", () => {
  const catalog = applyOverrides([
    {
      id: "not-a-real-service",
      priceLabel: "₱9",
    },
    {
      id: "cleaning",
      priceLabel: "<script>alert(1)</script>₱1,200–₱1,400 mild",
      chatbotEn: "Mild cleaning is ₱1,200–₱1,400.",
    },
  ]);
  const cleaning = catalog.services.find((item) => item.id === "cleaning");
  assert.equal(cleaning.priceLabel, "₱1,200–₱1,400 mild");
  assert.equal(cleaning.chatbotEn, "Mild cleaning is ₱1,200–₱1,400.");
  assert.equal(catalog.services.some((item) => item.id === "not-a-real-service"), false);
});

test("admin catalog edits flow into chatbot answers", () => {
  const resolved = resolveCatalog([
    {
      id: "fluoride",
      chatbotEn: "Fluoride Application is ₱1,500, confirmed by admin.",
    },
  ]);
  const result = answerFromCatalog("How much is fluoride application?", {
    services: SERVICES,
    dentists: DENTISTS,
    approvedServices: resolved.chatbotServices,
    approvedFactsEn: resolved.factsEn,
  });
  assert.match(result.answer, /confirmed by admin/);
});

test("loadApprovedClinicCatalog uses stored overrides and ignores a missing table", async () => {
  invalidateClinicCatalogCache();
  const db = {
    async query() {
      return {
        rows: [
          {
            setting_value: {
              services: [{ id: "whitening", chatbotEn: "Whitening is ₱10,000 per session from admin." }],
            },
          },
        ],
      };
    },
  };
  const loaded = await loadApprovedClinicCatalog(db);
  const whitening = loaded.chatbotServices.find((item) => item.id === "whitening");
  assert.match(whitening.en, /from admin/);
  invalidateClinicCatalogCache();

  const missing = {
    async query() {
      const error = new Error("missing");
      error.code = "42P01";
      throw error;
    },
  };
  const fallback = await loadApprovedClinicCatalog(missing);
  assert.match(fallback.chatbotServices.find((item) => item.id === "whitening").en, /₱10,000 per session/);
  invalidateClinicCatalogCache();
});
