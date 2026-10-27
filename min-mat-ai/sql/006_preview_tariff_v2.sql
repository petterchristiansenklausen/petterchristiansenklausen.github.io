-- PREVIEW ONLY. Do not apply on production while purchases are active.
-- Apple pricing is configured separately after user approval.
BEGIN;
UPDATE billing.config SET value = '{
 "version":2, "proBonusCredits":100,
 "costs":{"chef":3,"recipe-method":1,"inventory-photo":2,"recipe-image":8},
 "packs":{"com.pettersapps.MinMat.credits.starter":100,
          "com.pettersapps.MinMat.credits.standard":300,
          "com.pettersapps.MinMat.credits.large":1000}
}'::jsonb WHERE key='tariff' AND value->>'version'='1';
COMMIT;
