"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { postgresSslConfig } = require("../lib/postgresSsl");

test("local development does not force database TLS", () => {
  assert.equal(postgresSslConfig({ NODE_ENV: "development" }), undefined);
  assert.equal(postgresSslConfig({ NODE_ENV: "development", DATABASE_SSL: "disable" }), undefined);
});

test("production and DATABASE_SSL=require enable TLS with certificate verification", () => {
  assert.deepEqual(postgresSslConfig({ NODE_ENV: "production" }), { rejectUnauthorized: true });
  assert.deepEqual(postgresSslConfig({ DATABASE_SSL: "require" }), { rejectUnauthorized: true });
});

test("DATABASE_SSL=no-verify allows TLS without rejecting unauthorized certificates", () => {
  assert.deepEqual(postgresSslConfig({ DATABASE_SSL: "no-verify" }), { rejectUnauthorized: false });
});
