-- MIN MAT AI: additive, metadata-only request telemetry
-- REVIEW BEFORE APPLYING TO THE EXISTING QUOTA DATABASE.
-- A failed or unconfigured ledger MUST NEVER block Min Mat calls.
CREATE TABLE IF NOT EXISTS public.mine_mat_ai_usage (
    id uuid PRIMARY KEY,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    feature text NOT NULL CHECK (feature IN ('chef', 'inventory-photo', 'recipe-method', 'recipe-image')),
    model text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 100),
    gateway_status integer NOT NULL CHECK (gateway_status BETWEEN 100 AND 599),
    generation_id text UNIQUE,
    input_tokens integer,
    output_tokens integer,
    cost_usd numeric(16,8),
    CONSTRAINT valid_cost CHECK (cost_usd IS NULL OR cost_usd >= 0),
    CONSTRAINT valid_input CHECK (input_tokens IS NULL OR input_tokens >= 0),
    CONSTRAINT valid_output CHECK (output_tokens IS NULL OR output_tokens >= 0)
);
CREATE INDEX IF NOT EXISTS mine_mat_ai_usage_date_idx
    ON public.mine_mat_ai_usage (recorded_at DESC);
CREATE INDEX IF NOT EXISTS mine_mat_ai_usage_feature_date_idx
    ON public.mine_mat_ai_usage (feature, recorded_at DESC);

-- IMPORTANT: provision a separate DB login for Mine Apper Admin with SELECT
-- only on public.mine_mat_ai_usage, and USAGE on schema public.
-- Do not reuse the writer/quota DB credential in Mine Apper Admin.
-- Example, to be run by the DB owner with a securely generated password:
-- CREATE ROLE mine_mat_metrics_reader LOGIN PASSWORD '<create in database provider>';
-- GRANT CONNECT ON DATABASE ... TO mine_mat_metrics_reader;
-- GRANT USAGE ON SCHEMA public TO mine_mat_metrics_reader;
-- GRANT SELECT ON public.mine_mat_ai_usage TO mine_mat_metrics_reader;
