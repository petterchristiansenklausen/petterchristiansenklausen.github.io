-- Min Mat / Mine Apper Admin: anonymous, append-only AI usage register.
-- Apply manually after selecting the dedicated reporting database.
-- Do not put client data or prompts in this table.
CREATE TABLE IF NOT EXISTS public.min_mat_ai_usage (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  feature TEXT NOT NULL CHECK (feature IN ('chef','inventory-photo','recipe-method','recipe-image')),
  model TEXT NOT NULL CHECK (char_length(model) BETWEEN 1 AND 128),
  gateway_status INTEGER NOT NULL CHECK (gateway_status BETWEEN 100 AND 599),
  cost_usd NUMERIC(18,9) NULL CHECK (cost_usd >= 0),
  input_tokens BIGINT NULL CHECK (input_tokens >= 0),
  output_tokens BIGINT NULL CHECK (output_tokens >= 0)
);
CREATE INDEX IF NOT EXISTS min_mat_ai_usage_recorded_feature
  ON public.min_mat_ai_usage (recorded_at DESC, feature);
-- RESTRICT each connection separately:
-- * Min Mat runtime: INSERT on this table only, USAGE on identity sequence.
-- * Mine Apper Admin: SELECT on this table only.
-- Never reuse an owner/superuser connection URI in a public-facing backend.

