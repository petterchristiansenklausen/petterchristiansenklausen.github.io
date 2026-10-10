import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { getVercelOidcToken } from "@vercel/oidc";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, {
    status, headers: { "Cache-Control": "no-store" }
  });
}

function limit(value: string | undefined, fallback: number, maximum: number) {
  const n = Number(value ?? fallback);
  return Number.isSafeInteger(n) && n >= 1 && n <= maximum ? n : fallback;
}

// Distributed, atomic, fail-closed monthly and per-visitor cost protection.
// Never store raw IP addresses. The mobile client token is NOT user authentication.
async function reserveBudget(request: NextRequest) {
  const uri = process.env.MIN_MAT_IMAGE_LIMITS_DATABASE_URL;
  const salt = process.env.MIN_MAT_IMAGE_LIMIT_SALT;
  if (!uri || !salt || salt.length < 24) throw new Error("BUDGET_NOT_CONFIGURED");

  const day = new Date().toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const ip = (request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") || "unknown").split(",")[0].trim().slice(0, 64);
  const digest = createHash("sha256").update(salt + ":" + ip).digest("hex").slice(0, 32);
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

export async function POST(request: NextRequest) {
  const token = process.env.MIN_MAT_CLIENT_TOKEN;
  if (!token || request.headers.get("x-minmat-client") !== token) {
    return fail("Ugyldig klient.", 401);
  }

  let data: { title?: unknown; ingredients?: unknown };
  try {
    const text = await request.text();
    if (text.length > 6000) return fail("Forespørselen er for stor.", 413);
    data = JSON.parse(text);
  } catch { return fail("Ugyldig forespørsel.", 400); }

  if (!data || typeof data.title !== "string" || !data.title.trim() ||
      data.title.length > 120 || !Array.isArray(data.ingredients) ||
      data.ingredients.length > 20 ||
      data.ingredients.some((x) => typeof x !== "string" || x.length > 90)) {
    return fail("Oppskriften mangler navn eller har for mange ingredienser.", 400);
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
  } catch { return fail("AI-bilder er ikke konfigurert på serveren.", 503); }
  if (!auth) return fail("AI-bilder er ikke konfigurert på serveren.", 503);

  try {
    if (!(await reserveBudget(request))) {
      return fail("Grensen for AI-bilder er nådd. Bruk et eget bilde eller prøv igjen senere.", 429);
    }
  } catch {
    return fail("AI-bilder kan ikke brukes før kostnadsgrensen er konfigurert.", 503);
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 53000);
    let response: Response;
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
    } finally { clearTimeout(timer); }

    if (response.status === 402) return fail("AI-bildebudsjettet er brukt opp.", 429);
    if (!response.ok) return fail("Bildet kunne ikke lages akkurat nå. Prøv igjen senere.", 502);
    const result = (await response.json()) as { data?: { b64_json?: string }[] };
    const imageBase64 = result.data?.[0]?.b64_json;
    if (typeof imageBase64 !== "string" ||
        imageBase64.length < 100 || imageBase64.length > 6500000) {
      return fail("AI-tjenesten returnerte et ugyldig bilde.", 502);
    }
    return NextResponse.json({ imageBase64 }, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch { return fail("Tidsavbrudd ved bildegenerering. Prøv igjen senere.", 504); }
}
