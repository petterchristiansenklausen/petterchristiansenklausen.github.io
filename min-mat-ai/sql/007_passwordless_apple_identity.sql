-- Build 101: PREVIEW billing identity migration, not CloudKit and not telemetry.
BEGIN;
ALTER TABLE billing.customers ALTER COLUMN apple_sub DROP NOT NULL;
ALTER TABLE billing.customers ADD COLUMN IF NOT EXISTS app_environment text;
ALTER TABLE billing.customers ADD COLUMN IF NOT EXISTS app_transaction_id text;
ALTER TABLE billing.customers DROP CONSTRAINT IF EXISTS billing_customers_app_env_check;
ALTER TABLE billing.customers ADD CONSTRAINT billing_customers_app_env_check
 CHECK (app_environment IN ('Production','Sandbox') OR app_environment IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS billing_customer_app_identity_idx
 ON billing.customers(app_environment,app_transaction_id) WHERE app_transaction_id IS NOT NULL;
COMMIT;
