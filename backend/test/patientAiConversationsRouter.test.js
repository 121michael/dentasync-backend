"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const express = require("express");
const { createPatientPortalRouter } = require("../routes/patientPortal");
const { invalidateAiSettingsCache } = require("../services/aiSettings");

function createSharedStore() {
  const conversations = [];
  const messages = [];
  return { conversations, messages };
}

function createDb(store, userId) {
  return {
    async query(sql, params = []) {
      if (sql.includes("setting_key = 'ai'")) {
        return {
          rows: [
            {
              setting_value: {
                amethystAiEnabled: true,
                aiChatbot: true,
                chatbotKnowledgeMode: "clinic",
                diagnosticsSensitivity: "balanced",
                predictiveDiagnostics: true,
                waitingTimePrediction: true,
              },
            },
          ],
        };
      }
      if (sql.includes("setting_key = 'clinic'")) {
        return { rows: [] };
      }
      if (sql.includes("setting_key = 'clinic_schedule'") || sql.includes("FROM clinic_schedule_days")) {
        return { rows: [] };
      }
      if (sql.includes("FROM patient_portal_appointments") || sql.includes("FROM patient_portal_queue_entries")) {
        return { rows: [] };
      }
      if (sql.includes("SELECT 1 FROM ai_conversations")) {
        return { rows: [{ ok: 1 }] };
      }
      if (sql.includes("FROM ai_conversations") && sql.includes("WHERE id = $1 AND user_id = $2")) {
        const row = store.conversations.find((item) => item.id === params[0] && item.user_id === params[1]);
        return { rows: row ? [row] : [] };
      }
      if (sql.includes("FROM ai_conversations c") && sql.includes("WHERE c.user_id = $1")) {
        const rows = store.conversations
          .filter(
            (item) =>
              item.user_id === params[0] &&
              store.messages.some((message) => message.conversation_id === item.id)
          )
          .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
        return { rows };
      }
      if (sql.includes("FROM ai_messages") && sql.includes("WHERE conversation_id = $1")) {
        return {
          rows: store.messages
            .filter((item) => item.conversation_id === params[0])
            .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))),
        };
      }
      if (sql.includes("INSERT INTO ai_conversations")) {
        const row = {
          id: params[0],
          user_id: params[1],
          title: params[2],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        store.conversations.push(row);
        return { rows: [row] };
      }
      if (sql.includes("INSERT INTO ai_messages")) {
        store.messages.push({
          id: params[0],
          conversation_id: params[1],
          sender: "patient",
          content: params[2],
          source: null,
          attachment_name: params[3],
          attachment_document_id: params[4],
          analysis_json: null,
          created_at: new Date().toISOString(),
        });
        store.messages.push({
          id: params[5],
          conversation_id: params[1],
          sender: "ai",
          content: params[6],
          source: params[7],
          attachment_name: null,
          attachment_document_id: null,
          analysis_json: params[8] ? JSON.parse(params[8]) : null,
          created_at: new Date().toISOString(),
        });
        return { rows: [] };
      }
      if (sql.includes("UPDATE ai_conversations")) {
        const row = store.conversations.find((item) => item.id === params[0] && item.user_id === params[2]);
        if (!row) return { rows: [] };
        row.title = params[1];
        row.updated_at = new Date(Date.now() + 1000).toISOString();
        return { rows: [row] };
      }
      return { rows: [] };
    },
    userId,
  };
}

async function startPortal(store, userId) {
  invalidateAiSettingsCache();
  const uploadDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "amethyst-ai-history-"));
  const app = express();
  app.use(express.json());
  app.use(
    "/api/patient",
    createPatientPortalRouter({
      db: createDb(store, userId),
      authenticateToken(req, _res, next) {
        req.user = { id: userId, role: "patient" };
        req.authUser = { id: userId, role: "patient" };
        next();
      },
      uploadDirectory,
    })
  );
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/api/patient`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      fs.rmSync(uploadDirectory, { recursive: true, force: true });
    },
  };
}

test("assistant chat saves history and returns a conversation id", async () => {
  const store = createSharedStore();
  const portal = await startPortal(store, "patient-1");
  try {
    const response = await fetch(`${portal.url}/assistant/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "What are the clinic hours?" }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.answer, /Monday/i);
    assert.ok(body.conversationId);
    assert.equal(store.conversations.length, 1);
    assert.equal(store.conversations[0].user_id, "patient-1");
    assert.equal(store.messages.length, 2);
    assert.equal(store.messages[0].sender, "patient");
    assert.equal(store.messages[1].sender, "ai");
  } finally {
    await portal.close();
  }
});

test("patients can list, reopen, and continue the same conversation", async () => {
  const store = createSharedStore();
  const portal = await startPortal(store, "patient-1");
  try {
    const first = await fetch(`${portal.url}/assistant/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "How to prevent tooth decay" }),
    });
    const firstBody = await first.json();
    const list = await fetch(`${portal.url}/assistant/conversations`);
    assert.equal(list.status, 200);
    const listed = await list.json();
    assert.equal(listed.conversations.length, 1);
    assert.match(listed.conversations[0].title, /tooth decay/i);

    const opened = await fetch(`${portal.url}/assistant/conversations/${firstBody.conversationId}`);
    const openedBody = await opened.json();
    assert.equal(openedBody.messages.length, 2);

    const continued = await fetch(`${portal.url}/assistant/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "What toothpaste should I use?",
        conversationId: firstBody.conversationId,
      }),
    });
    const continuedBody = await continued.json();
    assert.equal(continuedBody.conversationId, firstBody.conversationId);
    assert.equal(store.conversations.length, 1);
    assert.equal(store.messages.length, 4);
  } finally {
    await portal.close();
  }
});

test("new chats do not delete previous conversations", async () => {
  const store = createSharedStore();
  const portal = await startPortal(store, "patient-1");
  try {
    const first = await (
      await fetch(`${portal.url}/assistant/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "Clinic operating hours" }),
      })
    ).json();
    const second = await (
      await fetch(`${portal.url}/assistant/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "Questions about dental fillings" }),
      })
    ).json();
    assert.notEqual(first.conversationId, second.conversationId);
    const listed = await (await fetch(`${portal.url}/assistant/conversations`)).json();
    assert.equal(listed.conversations.length, 2);
    assert.equal(listed.conversations[0].id, second.conversationId);
  } finally {
    await portal.close();
  }
});

test("one patient cannot open or continue another patient's conversation", async () => {
  const store = createSharedStore();
  const owner = await startPortal(store, "patient-1");
  const stranger = await startPortal(store, "patient-2");
  try {
    const created = await (
      await fetch(`${owner.url}/assistant/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "Appointment booking" }),
      })
    ).json();

    const stolenList = await fetch(`${stranger.url}/assistant/conversations`);
    assert.equal((await stolenList.json()).conversations.length, 0);

    const stolenGet = await fetch(`${stranger.url}/assistant/conversations/${created.conversationId}`);
    assert.equal(stolenGet.status, 404);

    const stolenChat = await fetch(`${stranger.url}/assistant/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "Can I see that earlier answer?",
        conversationId: created.conversationId,
      }),
    });
    assert.equal(stolenChat.status, 404);
    assert.equal(store.conversations.every((item) => item.user_id === "patient-1"), true);
  } finally {
    await owner.close();
    await stranger.close();
  }
});
