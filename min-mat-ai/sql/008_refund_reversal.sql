BEGIN;
ALTER TABLE billing.purchases ADD COLUMN IF NOT EXISTS refund_generation integer NOT NULL DEFAULT 0;
UPDATE billing.purchases SET refund_generation=1 WHERE revoked=true AND refund_generation=0;
COMMIT;
