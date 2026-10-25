# Min Mat AI request analytics (development branch only)

## Purpose
Enable privacy-preserving AI request measurement without Vercel Pro and without changes to the native Min Mat UI, CloudKit, purchases, or AI Gateway models.

Four features: chef, inventory-photo, recipe-method, recipe-image. A row is recorded after a request reached AI Gateway, even if Gateway returned a non-200 status. Usage includes timestamp, feature, model, HTTP status, token counts (if returned), a Gateway generation ID (when available) and exact USD cost from GET /v1/generation (when available).

Cost stays NULL when the Gateway generation ID is missing, billing is delayed, or lookup fails. **Do not equate NULL with zero.** Request counts are "recorded Gateway attempts since deployment", not lifetime totals. Historical requests will not appear without a separate import.

## Setup and safety
1. Use an **isolated preview database** and apply migrations/001_ai_usage_telemetry.sql there. Verify row constraints and permissions.
2. Configure MIN_MAT_IMAGE_LIMITS_DATABASE_URL in preview and verify the existing quota table: public.recipe_image_quota. Do not expose credentials in GitHub.
3. Exercise all four AI endpoints in preview and confirm the new usage table records without storing prompts, images or personal identifiers.
4. Confirm that cost from GET /v1/generation is available; exact cost might be NULL when lookup fails. Validate the recorded number against AI Gateway Logs.
5. Perform simulated DB failure and confirm responses still reach the app (except existing fail-closed quota reservations). Review code and plan production migration to the **same** DB as quota table.
6. Provision a **read-only database role** with SELECT on mine_mat_ai_usage ONLY for Mine Apper Admin. Store that role's connection string in admin Vercel env as MIN_MAT_REPORT_DATABASE_URL. Never reuse the quota database's write credential for admin.
7. Install the read-only connection in Preview first and test dashboard/export. Do not assign Production secrets until integration tests pass.
8. Merge/deploy with explicit approval when ready.

No new recurring subscriptions required. One exact cost lookup per generation may take a few seconds and can fail; this tracking is best effort and is scheduled after the response using Next.js after(). DB insertion requires migration; missing table only affects telemetry, not user-visible AI results.

NOTE: PR #1's quota refactor remains unmerged. This branch is based on PR #1, not the existing production Min Mat source. Avoid deploying it to Min Mat production without separately verifying the quota changes and database readiness.
