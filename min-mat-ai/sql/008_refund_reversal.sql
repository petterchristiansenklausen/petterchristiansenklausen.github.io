-- Build 108. Apply in a transaction to the dedicated billing database only.
-- Idempotent, additive. Does not change balances, existing customer wallets or
-- previous purchase identifiers. Existing refunded rows start at generation 1.
BEGIN;
ALTER TABLE billing.purchases
 ADD COLUMN IF NOT EXISTS refund_generation integer NOT NULL DEFAULT 0;
UPDATE billing.purchases SET refund_generation=1
 WHERE revoked=true AND refund_generation=0;
COMMIT;
