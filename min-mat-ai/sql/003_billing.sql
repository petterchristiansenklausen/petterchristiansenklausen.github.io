-- Run with a new billing owner on a dedicated database, never the telemetry roles.
BEGIN;
CREATE SCHEMA IF NOT EXISTS billing;
CREATE TABLE billing.customers (
 id uuid PRIMARY KEY, apple_sub text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE billing.challenges (id uuid PRIMARY KEY, nonce text NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE billing.sessions (
 token_hash text PRIMARY KEY, customer_id uuid NOT NULL REFERENCES billing.customers,
 environment text NOT NULL CHECK(environment IN ('Sandbox','Production')),
 app_transaction_id text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE billing.wallets (
 customer_id uuid REFERENCES billing.customers, environment text CHECK(environment IN ('Sandbox','Production')),
 balance integer NOT NULL DEFAULT 0, reserved integer NOT NULL DEFAULT 0 CHECK(reserved>=0),
 PRIMARY KEY(customer_id,environment)
);
CREATE TABLE billing.ledger (
 id bigserial PRIMARY KEY, customer_id uuid NOT NULL, environment text NOT NULL,
 event_key text NOT NULL, delta integer NOT NULL, kind text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(customer_id,environment,event_key),
 FOREIGN KEY(customer_id,environment) REFERENCES billing.wallets
);
CREATE TABLE billing.purchases (
 environment text NOT NULL, transaction_id text NOT NULL, customer_id uuid NOT NULL REFERENCES billing.customers,
 product_id text NOT NULL, credits integer NOT NULL, revoked boolean NOT NULL DEFAULT false,
 signed_at bigint NOT NULL, PRIMARY KEY(environment,transaction_id)
);
CREATE TABLE billing.requests (
 customer_id uuid NOT NULL, environment text NOT NULL, request_id uuid NOT NULL,
 feature text NOT NULL, input_hash text NOT NULL, cost integer NOT NULL CHECK(cost>0),
 state text NOT NULL CHECK(state IN ('reserved','ready','committed','released')),
 result jsonb, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 PRIMARY KEY(customer_id,environment,request_id),
 FOREIGN KEY(customer_id,environment) REFERENCES billing.wallets
);
CREATE TABLE billing.daily_limits (
 scope text NOT NULL, day date NOT NULL DEFAULT CURRENT_DATE, attempts integer NOT NULL DEFAULT 0,
 PRIMARY KEY(scope,day)
);
CREATE TABLE billing.config (key text PRIMARY KEY, value jsonb NOT NULL);
INSERT INTO billing.config VALUES ('tariff', '{"version":2,"proBonusCredits":100,"costs":{"chef":3,"recipe-method":1,"inventory-photo":2,"recipe-image":8},"packs":{"com.pettersapps.MinMat.credits.starter":100,"com.pettersapps.MinMat.credits.standard":300,"com.pettersapps.MinMat.credits.large":1000}}');
REVOKE ALL ON SCHEMA billing FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA billing FROM PUBLIC;
COMMIT;
-- Grant only the dedicated runtime role USAGE on schema, SELECT/INSERT/UPDATE/DELETE
-- on these tables and USAGE/SELECT on ledger's sequence. Never reuse AI reporting roles.
