-- Aggregated AI provider usage for Admin General Analytics.
-- Stores request metadata only: never prompts, chat transcripts, or API keys.

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id BIGSERIAL PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  feature TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failed')),
  user_id TEXT,
  user_role TEXT,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  http_status INTEGER
);

CREATE INDEX IF NOT EXISTS ai_usage_events_created_idx
  ON ai_usage_events (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS ai_usage_events_feature_idx
  ON ai_usage_events (feature, created_at DESC);

COMMENT ON TABLE ai_usage_events IS
  'One row per logical AI provider request. Used for Admin AI Usage analytics; no prompt or conversation content.';
