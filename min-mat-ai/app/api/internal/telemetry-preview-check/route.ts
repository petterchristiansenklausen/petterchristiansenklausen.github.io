import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Temporary preview-only connectivity test. Do not merge into production.
// Tests INSERT permission inside a PostgreSQL exception subtransaction
// that is rolled back. No usage record, secret or AI request is created.
export async function GET() {
  if (process.env.VERCEL_ENV !== "preview" ||
      process.env.VERCEL_GIT_COMMIT_REF !== "admin-ai-usage-telemetry-20261025") {
    return new Response(null, { status: 404 });
  }
  const uri = process.env.MIN_MAT_TELEMETRY_DATABASE_URL;
  if (!uri) {
    return NextResponse.json({ ok: false, reason: "not_configured" },
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const sql = neon(uri);
    const rows = await sql`
      SELECT
        current_database() = 'mine_apper_ai_reporting' AS expected_database,
        current_user = 'mine_ai_writer_restricted' AS expected_writer,
        has_table_privilege(current_user, 'public.min_mat_ai_usage', 'INSERT') AS can_insert,
        NOT has_table_privilege(current_user, 'public.min_mat_ai_usage', 'SELECT') AS cannot_read
    `;
    const r = rows[0];
    if (!r?.expected_database || !r?.expected_writer || !r?.can_insert || !r?.cannot_read) {
      return NextResponse.json({ ok: false, reason: "unexpected_role_or_permissions" },
        { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    // The exception is raised after INSERT and caught at the outer block
    // level: PostgreSQL rolls back all changes made in the inner block.
    await sql`
      DO $probe$
      BEGIN
        BEGIN
          INSERT INTO public.min_mat_ai_usage
            (feature, model, gateway_status, cost_usd, input_tokens, output_tokens)
          VALUES
            ('chef', 'internal-preview-rollback-check', 204, NULL, 0, 0);
          RAISE EXCEPTION 'INTERNAL_PREVIEW_ROLLBACK';
        EXCEPTION WHEN raise_exception THEN
          IF SQLERRM <> 'INTERNAL_PREVIEW_ROLLBACK' THEN
            RAISE;
          END IF;
        END;
      END
      $probe$;
    `;
    return NextResponse.json({
      ok: true, databaseConnected: true, expectedRestrictedWriter: true,
      insertCheckedWithoutPersisting: true, aiCreditsUsed: false
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, reason: "database_check_failed" },
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
