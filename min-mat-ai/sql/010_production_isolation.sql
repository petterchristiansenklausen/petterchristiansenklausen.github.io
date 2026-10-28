BEGIN;
DO $$ BEGIN
 IF current_database()<>'min_mat_billing_production' THEN RAISE EXCEPTION 'Wrong database'; END IF;
 IF EXISTS(SELECT 1 FROM billing.customers LIMIT 1) OR EXISTS(SELECT 1 FROM billing.purchases LIMIT 1)
 OR EXISTS(SELECT 1 FROM billing.ledger LIMIT 1) THEN RAISE EXCEPTION 'Production database not empty'; END IF;
END $$;
ALTER TABLE billing.customers ADD CONSTRAINT customers_only_production CHECK(app_environment IS NOT DISTINCT FROM 'Production');
ALTER TABLE billing.sessions ADD CONSTRAINT sessions_only_production CHECK(environment='Production');
ALTER TABLE billing.wallets ADD CONSTRAINT wallets_only_production CHECK(environment='Production');
ALTER TABLE billing.ledger ADD CONSTRAINT ledger_only_production CHECK(environment='Production');
ALTER TABLE billing.purchases ADD CONSTRAINT purchases_only_production CHECK(environment='Production');
ALTER TABLE billing.requests ADD CONSTRAINT requests_only_production CHECK(environment='Production');
INSERT INTO billing.config(key,value) VALUES('deployment_guard','{"environment":"Production","database":"min_mat_billing_production","allowProduction":false,"schema":10}') ON CONFLICT DO NOTHING;
COMMIT;
