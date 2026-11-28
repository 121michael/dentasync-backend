"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { recordQueueStatusEvent } = require("../services/queueStatusHistory");

function txnClient() {
  const commands = [];
  let aborted = false;
  const client = {
    release() {},
    async query(sql) {
      const text = String(sql);
      commands.push(text.trim());
      if (/^ROLLBACK TO SAVEPOINT/i.test(text.trim())) {
        aborted = false;
        return { rows: [] };
      }
      if (aborted) {
        throw Object.assign(
          new Error("current transaction is aborted, commands ignored until end of transaction block"),
          { code: "25P02" }
        );
      }
      if (/patient_portal_queue_status_events/.test(text)) {
        aborted = true;
        throw Object.assign(new Error('relation "patient_portal_queue_status_events" does not exist'), {
          code: "42P01",
        });
      }
      if (/called_at/.test(text) && /UPDATE/i.test(text)) {
        aborted = true;
        throw Object.assign(new Error('column "called_at" does not exist'), { code: "42703" });
      }
      return { rows: [] };
    },
  };
  return { client, commands };
}

test("Call patient history is optional when 064 columns and events are missing", async () => {
  const { client, commands } = txnClient();
  await recordQueueStatusEvent(client, {
    queueEntryId: 91,
    fromStatus: "waiting",
    toStatus: "preparing",
    actorId: "dentist-1",
    actorRole: "dentist",
  });
  await client.query("UPDATE patient_portal_queue_entries SET status = 'preparing' WHERE id = 91");
  assert.ok(commands.some((item) => /^SAVEPOINT /i.test(item)));
  assert.ok(commands.some((item) => /^ROLLBACK TO SAVEPOINT /i.test(item)));
  assert.equal(commands.filter((item) => item === "UPDATE patient_portal_queue_entries SET status = 'preparing' WHERE id = 91").length, 1);
});

test("Call patient still stamps called_at when the column exists", async () => {
  const commands = [];
  const client = {
    release() {},
    async query(sql, params) {
      const text = String(sql);
      commands.push({ text: text.trim(), params });
      return { rows: [] };
    },
  };
  await recordQueueStatusEvent(client, {
    queueEntryId: 91,
    fromStatus: "waiting",
    toStatus: "preparing",
    actorId: "dentist-1",
    actorRole: "dentist",
  });
  assert.ok(commands.some((item) => /patient_portal_queue_status_events/.test(item.text)));
  assert.ok(commands.some((item) => /SET called_at = COALESCE\(called_at, CURRENT_TIMESTAMP\)/.test(item.text)));
});
