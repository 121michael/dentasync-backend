"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const {
  FALLBACK_TITLE,
  titleFromPatientMessage,
  formatConversationHistoryBlock,
  conversationContextForPrompt,
  persistSuccessfulTurn,
  listConversations,
  listMessages,
  getOwnedConversation,
} = require("../services/patientAiConversations");

function createMemoryDb() {
  const conversations = [];
  const messages = [];
  let clock = Date.parse("2026-10-12T01:00:00.000Z");
  const nextStamp = () => new Date((clock += 1000)).toISOString();

  return {
    conversations,
    messages,
    async query(sql, params = []) {
      if (sql.includes("SELECT 1 FROM ai_conversations")) {
        return { rows: conversations.length ? [{ "?column?": 1 }] : [] };
      }
      if (sql.includes("FROM ai_conversations") && sql.includes("WHERE id = $1 AND user_id = $2")) {
        const row = conversations.find((item) => item.id === params[0] && item.user_id === params[1]);
        return { rows: row ? [row] : [] };
      }
      if (sql.includes("FROM ai_conversations c") && sql.includes("WHERE c.user_id = $1")) {
        const rows = conversations
          .filter(
            (item) =>
              item.user_id === params[0] && messages.some((message) => message.conversation_id === item.id)
          )
          .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
        return { rows };
      }
      if (sql.includes("FROM ai_messages") && sql.includes("WHERE conversation_id = $1")) {
        const rows = messages
          .filter((item) => item.conversation_id === params[0])
          .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
        return { rows };
      }
      if (sql.includes("INSERT INTO ai_conversations")) {
        const row = {
          id: params[0],
          user_id: params[1],
          title: params[2],
          created_at: nextStamp(),
          updated_at: nextStamp(),
        };
        conversations.push(row);
        return { rows: [row] };
      }
      if (sql.includes("INSERT INTO ai_messages")) {
        messages.push({
          id: params[0],
          conversation_id: params[1],
          sender: "patient",
          content: params[2],
          source: null,
          attachment_name: params[3],
          attachment_document_id: params[4],
          analysis_json: null,
          created_at: nextStamp(),
        });
        messages.push({
          id: params[5],
          conversation_id: params[1],
          sender: "ai",
          content: params[6],
          source: params[7],
          attachment_name: null,
          attachment_document_id: null,
          analysis_json: params[8] ? JSON.parse(params[8]) : null,
          created_at: nextStamp(),
        });
        return { rows: [] };
      }
      if (sql.includes("UPDATE ai_conversations")) {
        const row = conversations.find((item) => item.id === params[0] && item.user_id === params[2]);
        if (!row) return { rows: [] };
        row.title = params[1];
        row.updated_at = nextStamp();
        return { rows: [row] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

test("titles come from the first patient message, not a hardcoded list", () => {
  assert.equal(titleFromPatientMessage("What are the clinic hours?"), "What are the clinic hours?");
  assert.equal(titleFromPatientMessage("   "), FALLBACK_TITLE);
  assert.equal(titleFromPatientMessage("Please review this dental image."), "Dental image review");
  const long = "How do I take care of sensitive teeth after a cleaning appointment today?";
  const titled = titleFromPatientMessage(long);
  assert.ok(titled.startsWith("How do I take care"));
  assert.ok(titled.length <= 48);
  assert.ok(titled.endsWith("…"));
});

test("conversation context keeps only recent truncated turns", () => {
  const messages = Array.from({ length: 12 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    text: `${"word ".repeat(200)}${index}`,
  }));
  const context = conversationContextForPrompt(messages);
  assert.equal(context.length, 8);
  assert.ok(context[0].text.length <= 400);
  const block = formatConversationHistoryBlock(messages);
  assert.match(block, /Prior conversation/);
  assert.match(block, /Patient:/);
  assert.match(block, /Assistant:/);
});

test("persistSuccessfulTurn saves both sides and keeps the same conversation", async () => {
  const db = createMemoryDb();
  const first = await persistSuccessfulTurn(db, {
    userId: "patient-1",
    userContent: "What are the clinic hours?",
    assistantContent: "The clinic is open Monday to Friday.",
    source: "faq",
  });
  assert.equal(first.persisted, true);
  assert.equal(first.conversation.title, "What are the clinic hours?");

  const second = await persistSuccessfulTurn(db, {
    userId: "patient-1",
    conversationId: first.conversation.id,
    userContent: "And on weekends?",
    assistantContent: "Saturday and Sunday 11:00 AM–4:00 PM.",
    source: "faq",
  });
  assert.equal(second.conversation.id, first.conversation.id);
  assert.equal(second.conversation.title, "What are the clinic hours?");

  const listed = await listConversations(db, "patient-1");
  assert.equal(listed.length, 1);
  const stored = await listMessages(db, first.conversation.id);
  assert.equal(stored.length, 4);
  assert.equal(stored[0].role, "user");
  assert.equal(stored[1].role, "assistant");
});

test("a patient cannot load another patient's conversation", async () => {
  const db = createMemoryDb();
  const saved = await persistSuccessfulTurn(db, {
    userId: "patient-1",
    userContent: "Appointment booking",
    assistantContent: "You can book from Appointments.",
    source: "faq",
  });
  const stolen = await getOwnedConversation(db, "patient-2", saved.conversation.id);
  assert.equal(stolen, null);
  const otherList = await listConversations(db, "patient-2");
  assert.equal(otherList.length, 0);
});

test("failed or empty AI replies are not stored as answers", async () => {
  const db = createMemoryDb();
  const skipped = await persistSuccessfulTurn(db, {
    userId: "patient-1",
    userContent: "Hello",
    assistantContent: "  ",
  });
  assert.equal(skipped.persisted, false);
  assert.equal(db.messages.length, 0);
});

test("new chats stay separate from previous conversations", async () => {
  const db = createMemoryDb();
  await persistSuccessfulTurn(db, {
    userId: "patient-1",
    userContent: "Clinic operating hours",
    assistantContent: "Open weekdays 9 to 4.",
    source: "faq",
  });
  await persistSuccessfulTurn(db, {
    userId: "patient-1",
    userContent: "How to prevent tooth decay",
    assistantContent: "Brush twice a day with fluoride toothpaste.",
    source: "oral-health",
  });
  const listed = await listConversations(db, "patient-1");
  assert.equal(listed.length, 2);
  assert.equal(listed[0].title, "How to prevent tooth decay");
  assert.equal(listed[1].title, "Clinic operating hours");
  assert.notEqual(listed[0].id, listed[1].id);
  assert.ok(crypto.randomUUID());
});
