-- Additive telemetry migration. An estimated price is NOT measured provider spend.
ALTER TABLE public.min_mat_ai_usage
 ADD COLUMN IF NOT EXISTS estimated_cost_usd numeric;
ALTER TABLE public.min_mat_ai_usage
 DROP CONSTRAINT IF EXISTS min_mat_ai_estimated_cost_check;
ALTER TABLE public.min_mat_ai_usage
 ADD CONSTRAINT min_mat_ai_estimated_cost_check
 CHECK(estimated_cost_usd IS NULL OR estimated_cost_usd >= 0);
COMMENT ON COLUMN public.min_mat_ai_usage.estimated_cost_usd IS
 'Approximate provider price; actual cost_usd remains NULL when unreported';
