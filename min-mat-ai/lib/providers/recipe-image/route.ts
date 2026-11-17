import { aiFailure, requestID, gatewayCategory, exceptionCategory } from "../../ai-diagnostics";
import { prepareImageResult } from "../../ai-image-result";
import { createHash } from "node:crypto";
import { recordAiUsageLater } from "../../ai-usage";
import { estimateRecipeImageUSD } from "../../ai-image-estimate";
import { neon } from "@neondatabase/serverless";
import { getVercelOidcToken } from "@vercel/oidc";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function limit(value: string | undefined, fallback: number, maximum: number) {
  const n = Number(value ?? fallback);
  return Number.isSafeInteger(n) && n >= 1 && n <= maximum ? n : fallback;
}

// Distributed, atomic, fail-closed monthly and per-visitor cost protection.
// Never store raw IP addresses. The mobile client token is NOT user authentication.
export async function reserveBudget(request: NextRequest, account?: ImageAccount) {
  const uri = process.env.MIN_MAT_IMAGE_LIMITS_DATABASE_URL;
  const salt = process.env.MIN_MAT_IMAGE_LIMIT_SALT;
  if (!uri || !salt || salt.length < 24) throw new Error("BUDGET_NOT_CONFIGURED");

  const day = new Date().toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const ip = (request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") || "unknown").split(",")[0].trim().slice(0, 64);
  const digest = imageQuotaDigest(salt, ip, account);
  const monthKey = "minmat:image:month:" + month;
  const visitorKey = "minmat:image:visitor:" + day + ":" + digest;
  const monthlyLimit = limit(process.env.RECIPE_IMAGE_MONTHLY_LIMIT, 100, 1000);
  const dailyLimit = limit(process.env.RECIPE_IMAGE_DAILY_PER_VISITOR, 3, 10);

  // One SQL statement: no cross-instance race on quota reservation.
  const statement = [
    "WITH monthly AS (",
    "INSERT INTO public.recipe_image_quota (bucket,used,expires_at)",
    "VALUES ($1,1,($2::timestamptz + interval '45 days'))",
    "ON CONFLICT (bucket) DO UPDATE SET used=public.recipe_image_quota.used+1",
    "WHERE public.recipe_image_quota.used < $3 RETURNING used",
    "), visitor AS (",
    "INSERT INTO public.recipe_image_quota (bucket,used,expires_at)",
    "SELECT $4,1,($5::timestamptz + interval '3 days') FROM monthly",
    "ON CONFLICT (bucket) DO UPDATE SET used=public.recipe_image_quota.used+1",
    "WHERE public.recipe_image_quota.used < $6 RETURNING used",
    ") SELECT EXISTS(SELECT 1 FROM monthly) AS monthly_allowed,",
    "EXISTS(SELECT 1 FROM visitor) AS visitor_allowed"
  ].join(" ");
  const sql = neon(uri);
  const rows = await sql.query(statement,
    [monthKey, month + "-01T00:00:00Z", monthlyLimit, visitorKey,
     day + "T00:00:00Z", dailyLimit]);
  return rows[0]?.monthly_allowed === true && rows[0]?.visitor_allowed === true;
}

// Only the authenticated billing handler supplies this argument, never a client header.
export type ImageAccount = { id: string; environment: "Sandbox" | "Production" };
export function imageQuotaDigest(salt: string, ip: string, account?: ImageAccount) {
  const identity = account ? "account:" + account.environment + ":" + account.id.toLowerCase() : ip;
  return createHash("sha256").update(salt + ":" + identity).digest("hex").slice(0, 32);
}
export function createImageHandler(budget = reserveBudget) {
return async function imageHandler(request: NextRequest, account?: ImageAccount) {
  const id = requestID(request);
  const fail = (message: string, status: number, category: Parameters<typeof aiFailure>[4]) =>
    aiFailure(id, "recipe-image", message, status, category);
  const token = process.env.MIN_MAT_CLIENT_TOKEN;
  if (!token || request.headers.get("x-minmat-client") !== token) {
    return fail("Ugyldig klient.", 401, "client_auth");
  }

  let data: { title?: unknown; ingredients?: unknown };
  try {
    const text = await request.text();
    if (text.length > 6000) return fail("Forespørselen er for stor.", 413, "invalid_input");
    data = JSON.parse(text);
  } catch { return fail("Ugyldig forespørsel.", 400, "invalid_input"); }

  if (!data || typeof data.title !== "string" || !data.title.trim() ||
      data.title.length > 120 || !Array.isArray(data.ingredients) ||
      data.ingredients.length > 20 ||
      data.ingredients.some((x) => typeof x !== "string" || x.length > 90)) {
    return fail("Oppskriften mangler navn eller har for mange ingredienser.", 400, "invalid_input");
  }

  const title = data.title.trim();
  const ingredients = (data.ingredients as string[]).map(x => x.trim()).filter(Boolean);
  const prompt = [
    "Produce one photorealistic Scandinavian home-cooking food photograph.",
    "The prepared dish is: " + title + ".",
    "Only plausible ingredients for the dish: " +
      (ingredients.join(", ") || "as implied by the dish name") + ".",
    "A realistic, appetizing finished plated meal, natural daylight, neutral ceramics,",
    "square framing. No hands, people, packaging, logos, watermarks or text."
  ].join(" ");

  let auth: string | undefined;
  try {
    auth = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN ||
      await getVercelOidcToken();
  } catch { return fail("AI-bilder er ikke konfigurert på serveren.", 503, "gateway_auth"); }
  if (!auth) return fail("AI-bilder er ikke konfigurert på serveren.", 503, "gateway_auth");

  try {
    if (!(await budget(request, account))) {
      return fail("Grensen for AI-bilder er nådd. Bruk et eget bilde eller prøv igjen senere.", 429, "image_budget_limit");
    }
  } catch (error) {
    const category = error instanceof Error && error.message === "BUDGET_NOT_CONFIGURED" ? "image_budget_config" : "image_budget_unavailable";
    return fail("AI-bilder er midlertidig utilgjengelig på serveren.", 503, category);
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 53000);
    let response: Response;
    let result: any;
    try {
      response = await fetch("https://ai-gateway.vercel.sh/v1/images/generations", {
        method: "POST",
        headers: { Authorization: "Bearer " + auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "openai/gpt-image-2", prompt, n: 1,
          size: "1024x1024", quality: "low",
          output_format: "jpeg", output_compression: 75
        }),
        signal: controller.signal, cache: "no-store"
      });
      try { result = await response.json(); }
      catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        result = null;
      }
    } finally { clearTimeout(timer); }

    if (response.status === 402) {
      recordAiUsageLater("recipe-image", response.status, null, "openai/gpt-image-2");
      return fail("AI-bildebudsjettet er brukt opp.", 429, "gateway_budget");
    }
    if (!response.ok) {
      recordAiUsageLater("recipe-image", response.status, null, "openai/gpt-image-2");
      return fail("Bildet kunne ikke lages akkurat nå. Prøv igjen senere.", 502, gatewayCategory(response.status));
    }
    let imageBase64: string;
    try { imageBase64 = await prepareImageResult(result?.data?.[0]?.b64_json); }
    catch (error) {
      return fail("AI-tjenesten returnerte et ugyldig bilde.", 502,
        error instanceof Error && error.message === "image_too_large" ? "image_too_large" : "invalid_image");
    }
    // The cost estimate is NEVER saved in the actual provider cost column.
    recordAiUsageLater("recipe-image", response.status, result, "openai/gpt-image-2", auth,
      estimateRecipeImageUSD("openai/gpt-image-2", "low", "1024x1024", prompt) ?? undefined);
    return NextResponse.json({ imageBase64 }, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) { return fail("Kunne ikke fullføre bildegenerering. Prøv igjen senere.", 504, exceptionCategory(error)); }
}


}
export const POST = createImageHandler();
