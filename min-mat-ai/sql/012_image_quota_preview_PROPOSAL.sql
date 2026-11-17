-- PROPOSAL ONLY. Not executed by this delivery or by the application.
-- Run only after approval, in an isolated Preview quota database (never Production).
-- Use an administrative connection; grant the scoped runtime role only SELECT/INSERT/UPDATE.
BEGIN;
CREATE TABLE IF NOT EXISTS public.recipe_image_quota (
    bucket text PRIMARY KEY,
    used integer NOT NULL CHECK (used >= 0),
    expires_at timestamptz NOT NULL
);
COMMIT;
-- Set MIN_MAT_IMAGE_LIMITS_DATABASE_URL to the limited runtime connection in the
-- feature/min-mat-recipe-scan-build124 Preview branch only.
-- Supply a separate private MIN_MAT_IMAGE_LIMIT_SALT of at least 24 characters.
-- Do not copy a Production database URL or disable reserveBudget.
