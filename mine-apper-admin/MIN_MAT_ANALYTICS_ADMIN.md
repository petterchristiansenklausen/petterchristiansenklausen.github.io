# Mine Apper Admin — Min Mat AI analytics

This change adds a read-only dashboard for AI Gateway usage by feature (Chef, Inventory scan, Recipe method, Recipe image), day, 7/30/90-day period, known exact USD cost, missing/unresolved cost counts, and token usage. It offers copy/download of the admin's JSON report. No PII, prompts, recipes, IPs, images, or credentials are returned.

The admin backend reads ONLY aggregated rows from public.mine_mat_ai_usage, with a dedicated DB login having SELECT permission on that table and no access to Min Mat customer data or quota tables.

Setup requires a separate Min Mat AI deployment from branch min-mat-ai-usage-telemetry-phase2, after PR #1 quota review:
1. Apply min-mat-ai/migrations/001_ai_usage_telemetry.sql to isolated preview DB first, and verify.
2. Provision a DB login with USAGE on schema public and SELECT on public.mine_mat_ai_usage only.
3. Put its connection URI in Vercel mine-apper-admin Preview env as MIN_MAT_REPORT_DATABASE_URL (Sensitive). Do not copy MIN_MAT_IMAGE_LIMITS_DATABASE_URL from Min Mat, since that may have write access.
4. Verify test data values, response from /api/admin/ai-report, unauthorized request 403, and JSON export.
5. After approvals, provision production table and SELECT-only reader; set the production env, then redeploy admin. No DB secret should ever be committed or shared in chat.

Optional advisory alert thresholds (not hard limits) are MIN_MAT_AI_ALERT_DAILY_USD and MIN_MAT_AI_ALERT_MONTHLY_USD; keep absent until owner approves thresholds. When threshold exists, show a warning from 75% onward. No push/email alerts are implemented; alerts appear in the admin UI and JSON export only. Real spend restriction must happen in Vercel AI Gateway budgets.

If table or reader is absent, report says NOT CONNECTED, never 0 dollars. Exact spend can be unknown for some rows; unknown never equals zero. No retroactive claim for past requests; historic request capture begins when Min Mat's telemetry is deployed and migration is active.

Vercel Hobby does not provide the full Custom Reporting API; this uses the private Neon SQL metadata ledger instead, with no Pro upgrade.
