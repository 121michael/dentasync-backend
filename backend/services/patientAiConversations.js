"use strict";

const crypto = require("crypto");

const FALLBACK_TITLE = "New Conversation";
const TITLE_MAX_LENGTH = 48;
const CONTEXT_MESSAGE_LIMIT = 8;
const CONTEXT_CHAR_LIMIT = 400;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isMissingRelation(error) {
  return error?.code === "42P01" || error?.code === "42703";
}

function isUuid(value) {
  return UUID_RE.test(String(value || "").trim());
}

function titleFromPatientMessage(text) {
  const cleaned = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return FALLBACK_TITLE;
  if (/^please review this dental image\.?$/i.test(cleaned)) {
    return "Dental image review";
  }
  if (cleaned.length <= TITLE_MAX_LENGTH) return cleaned;
  return `${cleaned.slice(0, TITLE_MAX_LENGTH - 1).trim()}…`;
}

function mapMessage(row) {
  if (!row) return null;
  const analysis = row.analysis_json || null;
  return {
    id: row.id,
    role: row.sender === "patient" ? "user" : "assistant",
    sender: row.sender,
    text: row.content,
    source: row.source || null,
    attachmentName: row.attachment_name || null,
    attachmentDocumentId: row.attachment_document_id || null,
    analysis,
    createdAt: row.created_at,
  };
}

function mapConversation(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title || FALLBACK_TITLE,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function conversationContextForPrompt(messages) {
  if (!Array.isArray(messages) || !messages.length) return [];
  return messages.slice(-CONTEXT_MESSAGE_LIMIT).map((item) => {
    const role = item.role === "user" || item.sender === "patient" ? "Patient" : "Assistant";
    const text = String(item.text || item.content || "").slice(0, CONTEXT_CHAR_LIMIT);
    return { role, text };
  });
}

function formatConversationHistoryBlock(messages) {
  const context = conversationContextForPrompt(messages);
  if (!context.length) return "";
  return `Prior conversation (oldest first; use as context only — do not repeat unless asked):\n${context
    .map((item) => `${item.role}: ${item.text}`)
    .join("\n")}`;
}

async function historyEnabled(db) {
  try {
    await db.query("SELECT 1 FROM ai_conversations LIMIT 1");
    return true;
  } catch (error) {
    if (isMissingRelation(error)) return false;
    throw error;
  }
}

async function getOwnedConversation(db, userId, conversationId) {
  if (!isUuid(conversationId)) return null;
  try {
    const result = await db.query(
      `SELECT id, user_id, title, created_at, updated_at
       FROM ai_conversations
       WHERE id = $1 AND user_id = $2
       LIMIT 1`,
      [conversationId, String(userId)]
    );
    return result.rows[0] || null;
  } catch (error) {
    if (isMissingRelation(error)) return null;
    throw error;
  }
}

async function listConversations(db, userId) {
  try {
    const result = await db.query(
      `SELECT c.id, c.title, c.created_at, c.updated_at
       FROM ai_conversations c
       WHERE c.user_id = $1
         AND EXISTS (
           SELECT 1 FROM ai_messages m WHERE m.conversation_id = c.id
         )
       ORDER BY c.updated_at DESC
       LIMIT 100`,
      [String(userId)]
    );
    return result.rows.map(mapConversation);
  } catch (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }
}

async function listMessages(db, conversationId) {
  try {
    const result = await db.query(
      `SELECT id, conversation_id, sender, content, source, attachment_name,
              attachment_document_id, analysis_json, created_at
       FROM ai_messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC, id ASC`,
      [conversationId]
    );
    return result.rows.map(mapMessage);
  } catch (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }
}

async function persistSuccessfulTurn(db, input) {
  const userId = String(input.userId);
  const userContent = String(input.userContent || "").trim();
  const assistantContent = String(input.assistantContent || "").trim();
  if (!userContent || !assistantContent) {
    return { conversation: null, persisted: false };
  }

  try {
    let conversation = null;
    if (input.conversationId && isUuid(input.conversationId)) {
      conversation = await getOwnedConversation(db, userId, input.conversationId);
      if (!conversation) {
        return { conversation: null, persisted: false, notFound: true };
      }
    } else {
      const id = crypto.randomUUID();
      const title = titleFromPatientMessage(userContent);
      const created = await db.query(
        `INSERT INTO ai_conversations (id, user_id, title)
         VALUES ($1, $2, $3)
         RETURNING id, user_id, title, created_at, updated_at`,
        [id, userId, title]
      );
      conversation = created.rows[0];
    }

    const userMessageId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();
    await db.query(
      `INSERT INTO ai_messages (
         id, conversation_id, sender, content, source, attachment_name, attachment_document_id, analysis_json
       ) VALUES
         ($1, $2, 'patient', $3, NULL, $4, $5, NULL),
         ($6, $2, 'ai', $7, $8, NULL, NULL, $9::jsonb)`,
      [
        userMessageId,
        conversation.id,
        userContent,
        input.attachmentName || null,
        input.attachmentDocumentId || null,
        assistantMessageId,
        assistantContent,
        input.source || null,
        input.analysis ? JSON.stringify(input.analysis) : null,
      ]
    );

    const nextTitle =
      !conversation.title || conversation.title === FALLBACK_TITLE
        ? titleFromPatientMessage(userContent)
        : conversation.title;

    const updated = await db.query(
      `UPDATE ai_conversations
       SET title = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $3
       RETURNING id, user_id, title, created_at, updated_at`,
      [conversation.id, nextTitle, userId]
    );

    return {
      conversation: mapConversation(updated.rows[0] || { ...conversation, title: nextTitle }),
      persisted: true,
    };
  } catch (error) {
    if (isMissingRelation(error)) {
      return { conversation: null, persisted: false, unavailable: true };
    }
    console.warn("Unable to persist AI conversation:", error.message);
    return { conversation: null, persisted: false, error: error.message };
  }
}

module.exports = {
  FALLBACK_TITLE,
  CONTEXT_MESSAGE_LIMIT,
  titleFromPatientMessage,
  isUuid,
  mapMessage,
  mapConversation,
  conversationContextForPrompt,
  formatConversationHistoryBlock,
  historyEnabled,
  getOwnedConversation,
  listConversations,
  listMessages,
  persistSuccessfulTurn,
};
