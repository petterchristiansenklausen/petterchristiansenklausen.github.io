-- Create min_mat_billing_app as a LOGIN role with a securely generated password
-- using SQL, NOCREATEDB NOCREATEROLE NOBYPASSRLS, no role memberships.
-- Neon console-created roles may inherit neon_superuser: do not use those for runtime.
GRANT CONNECT ON DATABASE min_mat_billing_preview TO min_mat_billing_app;
GRANT USAGE ON SCHEMA billing TO min_mat_billing_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON billing.challenges,billing.sessions TO min_mat_billing_app;
GRANT SELECT,INSERT,UPDATE ON billing.customers,billing.wallets,billing.purchases,billing.requests,billing.daily_limits TO min_mat_billing_app;
GRANT SELECT,INSERT ON billing.ledger TO min_mat_billing_app;
GRANT SELECT ON billing.config TO min_mat_billing_app;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA billing TO min_mat_billing_app;
