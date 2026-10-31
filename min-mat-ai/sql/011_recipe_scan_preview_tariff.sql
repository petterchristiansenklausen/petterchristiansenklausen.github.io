-- Execute only in the isolated Sandbox/Preview billing database, never Production.
-- Safe to rerun: add recipe-scan cost and bump tariff version once.
BEGIN;
UPDATE billing.config
SET value = jsonb_set(jsonb_set(value, '{costs,recipe-scan}', '8'::jsonb, true),
                      '{version}', to_jsonb((value->>'version')::int + 1), true)
WHERE key='tariff' AND NOT ((value->'costs') ? 'recipe-scan');
COMMIT;
