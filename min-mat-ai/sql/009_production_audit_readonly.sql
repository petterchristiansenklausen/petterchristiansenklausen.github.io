-- READ-ONLY BILLING AUDIT – build 108
-- Run only with a restricted reporting role on the dedicated billing database.
-- DO NOT share customer UUIDs, transaction IDs, API keys or emails in screenshots.

-- 1. Customer and wallet counts by verified Apple environment.
SELECT environment, count(*) wallets,
 sum(balance)::bigint total_balance, sum(reserved)::bigint total_reserved,
 count(*) FILTER (WHERE balance < 0) negative_wallets
FROM billing.wallets GROUP BY environment ORDER BY environment;

-- 2. Ledger balance must equal current wallet balance, per environment.
SELECT w.environment, count(*) FILTER (WHERE w.balance <> COALESCE(l.total,0)) mismatched_wallets
FROM billing.wallets w
LEFT JOIN (SELECT customer_id,environment,sum(delta)::bigint total FROM billing.ledger GROUP BY customer_id,environment) l
  ON l.customer_id=w.customer_id AND l.environment=w.environment
GROUP BY w.environment ORDER BY w.environment;

-- 3. Aggregate purchase reconciliation: one purchase event per Apple transaction,
-- refunds and refund reversals. Actual Apple API reconciliation is separate.
SELECT p.environment,
 count(*) transaction_rows,
 count(*) FILTER (WHERE p.revoked) currently_refunded,
 sum(p.credits) total_original_credits
FROM billing.purchases p GROUP BY p.environment ORDER BY p.environment;

-- 4. Stale pending AI jobs by environment (should be released on next wallet access).
SELECT environment, state, count(*) jobs FROM billing.requests
WHERE state IN ('reserved','ready') AND expires_at < now()
GROUP BY environment,state ORDER BY environment,state;
