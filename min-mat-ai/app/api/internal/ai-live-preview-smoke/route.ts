import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { POST as recipeMethodPost } from "../../recipe-method/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

// TEMPORARY: preview-only one-time real AI smoke test. Remove immediately.
// The only authorized test string is a private ephemeral value, never a
// service credential. Do not merge this endpoint to production.
const expectedHash = "66d9293a48d0d5ec2619b59cffec4bffde892e8d777ac32b9199e32d8c79339e";
const globalTestState = globalThis as typeof globalThis & { __minMatPreviewOneTimeRun?: boolean };

export async function GET(request: NextRequest) {
  if (process.env.VERCEL_ENV !== "preview" ||
      process.env.VERCEL_GIT_COMMIT_REF !== "admin-ai-usage-telemetry-20261025" ||
      Date.now() > Date.parse("2026-10-26T02:00:00Z")) {
    return new Response(null, { status: 404 });
  }

  const supplied = request.nextUrl.searchParams.get("k") || "";
  if (supplied.length < 30 || supplied.length > 100) {
    return new Response(null, { status: 404 });
  }
  const digest = createHash("sha256").update(supplied).digest();
  if (!timingSafeEqual(digest, Buffer.from(expectedHash, "hex"))) {
    return new Response(null, { status: 404 });
  }

  // In-process replay guard; the 48-byte random token also prevents
  // unauthorized callers from reaching this test route.
  if (globalTestState.__minMatPreviewOneTimeRun) {
    return NextResponse.json({ tested: false, reason: "already_ran" }, { status: 409 });
  }
  globalTestState.__minMatPreviewOneTimeRun = true;

  const clientToken = process.env.MIN_MAT_CLIENT_TOKEN;
  if (!clientToken) {
    return NextResponse.json({ tested: false, reason: "client_token_not_configured" }, { status: 503 });
  }
  // Invoke Min Mat's actual recipe-method route (not a simulated DB insert).
  // One tiny synthetic recipe with no user's personal data.
  const testRequest = new NextRequest(
    new URL("/api/recipe-method", request.url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-minmat-client": clientToken,
        "x-minmat-installation": "00000000-0000-4000-8000-000000000001"
      },
      body: JSON.stringify({
        title: "Kokt egg", portions: 1, language: "nb",
        ingredients: [{ name: "egg", amount: 1, unit: "stk" }]
      })
    }
  );
  try {
    const response = await recipeMethodPost(testRequest);
    const body = await response.json().catch(() => null);
    return NextResponse.json({
      tested: true,
      aiEndpointHttpStatus: response.status,
      validRecipeSteps: response.ok && Array.isArray(body?.steps) && body.steps.length >= 2,
      // Asynchronous telemetry must be checked independently in Neon after reply.
      telemetryCheckPending: true
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ tested: true, aiEndpointHttpStatus: 500, validRecipeSteps: false },
      { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
