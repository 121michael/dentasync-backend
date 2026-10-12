-- Patient AI Assistant chat history.
-- These conversations are NOT part of the official dental treatment record.
-- Access is scoped to the authenticated patient (user_id) only.

CREATE TABLE IF NOT EXISTS ai_conversations (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'New Conversation',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ai_conversations_user_updated_idx
  ON ai_conversations (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_messages (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  sender TEXT NOT NULL CHECK (sender IN ('patient', 'ai')),
  content TEXT NOT NULL,
  source TEXT,
  attachment_name TEXT,
  attachment_document_id UUID,
  analysis_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ai_messages_conversation_created_idx
  ON ai_messages (conversation_id, created_at);

COMMENT ON TABLE ai_conversations IS
  'Patient AI Assistant conversations. Private to the owning patient account; not a clinical record.';
COMMENT ON TABLE ai_messages IS
  'Messages within a Patient AI Assistant conversation. Image binaries stay in document storage; only attachment metadata is stored here.';
