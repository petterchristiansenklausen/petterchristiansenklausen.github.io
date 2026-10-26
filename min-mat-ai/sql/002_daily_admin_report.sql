-- Private read-only summary for Mine Apper Admin.
-- Deploy this to the dedicated mine_apper_ai_reporting database after 001_ai_usage.sql.
-- Missing cost is reported separately; NULL means unknown, not $0.
CREATE OR REPLACE VIEW public.min_mat_ai_daily WITH (security_invoker=true) AS
SELECT
  (recorded_at AT TIME ZONE 'UTC')::date AS day,
  feature,
  model,
  COUNT(*)::bigint AS requests,
  COUNT(*) FILTER (WHERE gateway_status NOT BETWEEN 200 AND 299)::bigint AS errors,
  COUNT(*) FILTER (WHERE cost_usd IS NULL)::bigint AS missing_cost,
  SUM(cost_usd)::numeric(18,9) AS known_cost_usd,
  SUM(input_tokens)::bigint AS input_tokens,
  SUM(output_tokens)::bigint AS output_tokens,
  MAX(recorded_at) AS latest_recorded_at
FROM public.min_mat_ai_usage
GROUP BY 1,2,3;

REVOKE ALL ON public.min_mat_ai_daily FROM PUBLIC;
GRANT SELECT ON public.min_mat_ai_daily TO mine_ai_reader_restricted;
COMMENT ON VIEW public.min_mat_ai_daily IS
  'Daily counts and actual AI Gateway spend; NULL prices are explicitly counted';

