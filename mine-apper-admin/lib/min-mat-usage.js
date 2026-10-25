import { neon } from "@neondatabase/serverless";

const KNOWN_FEATURES = {
  chef: "AI-kokk",
  "inventory-photo": "Vareskanning",
  "recipe-method": "Fremgangsmåte",
  "recipe-image": "Oppskriftsbilder"
};

function optionalThreshold(key) {
  const v = process.env[key];
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 100000 ? n : null;
}
function nonnegative(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export async function readMinMatUsage() {
  const databaseURL = process.env.MIN_MAT_REPORT_DATABASE_URL;
  if (!databaseURL) return {
    status: "not_connected",
    reason: "read_only_database_not_configured",
    note: "Måleregisteret er ikke tilkoblet. Vi må opprette tabellen og en egen databasebruker med bare lesetilgang."
  };

  try {
    const sql = neon(databaseURL);
    // Aggregates only; no prompts, images, user IDs or per-request information.
    const rows = await sql`
      SELECT (recorded_at AT TIME ZONE 'UTC')::date::text AS day,
             feature, model,
             COUNT(*)::int AS requests,
             COUNT(*) FILTER (WHERE gateway_status < 200 OR gateway_status >= 300)::int AS errors,
             COUNT(*) FILTER (WHERE cost_usd IS NULL)::int AS missing_cost,
             COALESCE(SUM(cost_usd),0)::text AS known_usd,
             COALESCE(SUM(input_tokens),0)::bigint::text AS input_tokens,
             COALESCE(SUM(output_tokens),0)::bigint::text AS output_tokens
      FROM public.mine_mat_ai_usage
      WHERE recorded_at >= now() - interval '90 days'
      GROUP BY 1,2,3 ORDER BY 1 ASC,2,3
    `;

    const daily = rows
      .filter((row) => Object.hasOwn(KNOWN_FEATURES, row.feature))
      .map((row) => ({
        day: String(row.day).slice(0,10),
        feature: row.feature,
        featureName: KNOWN_FEATURES[row.feature],
        model: String(row.model).slice(0,100),
        requests: nonnegative(row.requests),
        errors: nonnegative(row.errors),
        missingCost: nonnegative(row.missing_cost),
        knownCostUSD: nonnegative(row.known_usd),
        inputTokens: nonnegative(row.input_tokens),
        outputTokens: nonnegative(row.output_tokens)
      }));

    return {
      status: "available",
      projectName: "min-mat-ai",
      scope: "recorded_gateway_requests_since_activation",
      timeZone: "UTC",
      maxDays: 90,
      daily,
      thresholds: {
        dailyUSD: optionalThreshold("MIN_MAT_AI_ALERT_DAILY_USD"),
        monthlyUSD: optionalThreshold("MIN_MAT_AI_ALERT_MONTHLY_USD"),
        advisoryOnly: true
      },
      note: "Kostnad vises bare når Gateway har bekreftet den. Uavklarte kostnader telles separat. Dette registeret inneholder ikke historisk bruk fra før målingen ble aktivert."
    };
  } catch {
    return {
      status: "unavailable",
      reason: "database_read_failed",
      note: "Kunne ikke lese Min Mat-målingene. Kontroller database, leserettigheter og om måletabellen finnes."
    };
  }
}
