-- Run ONLY in the isolated Sandbox/Preview billing database after deploying the
-- recipe-scan provider and its tests. NEVER run against Production by default.
-- Idempotent: do not change tariff twice on rerun.
BEGIN;
UPDATE billing.config
SET value = jsonb_set(jsonb_set(value, '{costs,recipe-scan}', '8'::jsonb, true),
                      '{version}', to_jsonb((value->>'version')::int + 1), true)
WHERE key='tariff' AND NOT ((value->'costs') ? 'recipe-scan');
COMMIT;
-- Verify SELECT value FROM billing.config WHERE key='tariff';
