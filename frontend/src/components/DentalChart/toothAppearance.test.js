import assert from "node:assert/strict";
import test from "node:test";
import { emptyToothRecord, toothAppearance } from "./dentalChartData.js";

test("unrecorded teeth stay neutral and are not marked healthy", () => {
  const appearance = toothAppearance(emptyToothRecord(11));
  assert.equal(appearance.key, "unrecorded");
  assert.equal(appearance.label, "No recorded status");
});

test("recorded healthy teeth use the healthy color", () => {
  const appearance = toothAppearance({
    ...emptyToothRecord(21),
    status: "healthy",
    condition: ["healthy"],
    updatedAt: "2026-11-17T00:00:00.000Z",
  });
  assert.equal(appearance.key, "healthy");
  assert.equal(appearance.label, "Healthy");
});

test("decay and attention map to the orange decay color", () => {
  assert.equal(
    toothAppearance({ status: "needs_attention", condition: ["decay"], treatments: [] }).key,
    "decay"
  );
  assert.equal(
    toothAppearance({ status: "healthy", condition: ["fractured"], treatments: [] }).key,
    "decay"
  );
});

test("root canal, filling, and crown map to treated blue", () => {
  assert.equal(
    toothAppearance({ status: "treated", condition: [], treatments: ["root_canal"] }).key,
    "treated"
  );
  assert.equal(
    toothAppearance({ status: "healthy", condition: [], treatments: ["filling"] }).key,
    "treated"
  );
  assert.equal(
    toothAppearance({ status: "treated", condition: ["crown"], treatments: ["crown"] }).key,
    "treated"
  );
});

test("braces and under_treatment map to purple", () => {
  assert.equal(
    toothAppearance({ status: "under_treatment", condition: [], treatments: ["braces"] }).key,
    "under_treatment"
  );
});

test("extraction maps to muted missing gray for adult and pediatric teeth", () => {
  assert.equal(
    toothAppearance({ toothNumber: "36", status: "missing", condition: ["missing"], treatments: ["extraction"] }).key,
    "missing"
  );
  assert.equal(
    toothAppearance({ toothNumber: "75", status: "missing", treatments: ["extraction"], condition: [] }).key,
    "missing"
  );
});
