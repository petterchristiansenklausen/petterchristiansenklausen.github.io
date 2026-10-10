import { getVercelOidcToken } from "@vercel/oidc";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

type Ingredient = { name: string; amount: number; unit: string; optional?: boolean };
type MethodRequest = {
  title: string;
  portions: number;
  language?: string;
  ingredients: Ingredient[];
};

function failure(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

function clean(value: unknown, limit: number) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

// Same conservative, in-instance hourly abuse protection as /api/chef.
// This is not an absolute financial budget; paid usage remains governed by Vercel AI Gateway.
const counters = globalThis as typeof globalThis & {
  __minMatMethodRates?: Map<string, { count: number; until: number }>
};
const counts = counters.__minMatMethodRates ?? new Map<string, { count: number; until: number }>();
counters.__minMatMethodRates = counts;
function isAllowed(request: NextRequest) {
  const supplied = request.headers.get("x-minmat-installation") || "";
  const ip = (request.headers.get("x-forwarded-for") || "unknown").split(",")[0].slice(0, 80);
  const key = /^[a-f0-9-]{20,80}$/i.test(supplied) ? supplied : ip;
  const existing = counts.get(key);
  const now = Date.now();
  if (!existing || now > existing.until) {
    counts.set(key, { count: 1, until: now + 3600000 });
    return true;
  }
  if (existing.count >= 30) return false;
  existing.count++;
  return true;
}

export async function POST(request: NextRequest) {
  if (!process.env.MIN_MAT_CLIENT_TOKEN ||
      request.headers.get("x-minmat-client") !== process.env.MIN_MAT_CLIENT_TOKEN) {
    return failure("Ugyldig klient.", 401);
  }

  let input: MethodRequest;
  try {
    const raw = await request.text();
    if (raw.length > 14000) return failure("Oppskriften inneholder for mye tekst.", 413);
    input = JSON.parse(raw);
  } catch {
    return failure("Kunne ikke lese oppskriften.", 400);
  }

  if (!input || typeof input !== "object" ||
      typeof input.title !== "string" || !input.title.trim() ||
      !Array.isArray(input.ingredients) || input.ingredients.length < 1 ||
      input.ingredients.length > 50) {
    return failure("Oppskriften mangler tittel eller ingredienser.", 400);
  }

  const ingredients = input.ingredients
    .filter((x) => x && typeof x === "object")
    .map((x) => ({
      name: clean(x.name, 180),
      amount: Number.isFinite(Number(x.amount)) ? Math.max(0, Math.min(100000, Number(x.amount))) : 0,
      unit: clean(x.unit, 12),
      optional: x.optional === true
    }))
    .filter((x) => x.name);
  if (!ingredients.length) return failure("Ingen lesbare ingredienser i oppskriften.", 400);
  if (!isAllowed(request)) return failure("For mange forespørsler. Prøv igjen senere.", 429);

  let token: string | undefined;
  try {
    token = process.env.AI_GATEWAY_API_KEY ||
      process.env.VERCEL_OIDC_TOKEN || await getVercelOidcToken();
  } catch {
    return failure("AI-tjenesten er midlertidig utilgjengelig.", 503);
  }
  if (!token) return failure("AI-tjenesten er ikke konfigurert.", 503);

  const portions = Number.isFinite(Number(input.portions))
    ? Math.max(1, Math.min(40, Math.round(Number(input.portions)))) : 4;
  const language = clean(input.language, 16) || "nb";
  const system = [
    "Du er en erfaren matfaglig assistent som lager praktiske fremgangsmåter.",
    "Dette er en OPPSKRIFT med egne ingredienser, ikke en beholdningsliste eller en forespørsel om middagsforslag.",
    "Skriv i språket " + language + " og behold oppgitt porsjonsantall og ingrediensmengder.",
    "Bruk kun ingrediensene som er listet. Vann, ovnstemperatur, koketid, blanding og varmebehandling kan forklares som tilberedning.",
    "Et rått importert ingrediensnavn kan inneholde ord som 'minst', 'saft av' eller ekstra tegn. Tolk dette nøkternt som matvareinformasjon.",
    "Ikke be om at ingrediensene er i matlageret. Ikke foreslå nye retter og ikke fyll handleliste.",
    "Lag én komplett og selvstendig fremgangsmåte fra ingrediensfakta, ikke fra kopiert kildetekst.",
    "For baking: skill mellom røre, eventuelle topping-/fyllkomponenter, steking og avkjøling når det er relevant.",
    "Ikke påstå en garantert ovnstemperatur eller tilberedningstid; gi normalt startpunkt og be brukeren følge med på resultatet.",
    "Returner KUN et JSON-objekt { \"steps\": [\"Gjør dette ...\", \"Så dette ...\"] }.",
    "Gi 4-12 brukbare, korte steg. Ingen tomme steg. Ikke kopier eller gjenfortell en kildeoppskrift ordrett."
  ].join("\n");

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 39000);
    let response: Response;
    try {
      response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "openai/gpt-5.6-luna",
          messages: [
            { role: "system", content: system },
            { role: "user", content: JSON.stringify({
              title: clean(input.title, 140),
              portions, ingredients
            }) }
          ],
          response_format: { type: "json_object" },
          max_completion_tokens: 2100
        }),
        signal: controller.signal, cache: "no-store"
      });
    } finally { clearTimeout(timer); }
    const reply = await response.json().catch(() => ({})) as any;
    if (!response.ok) {
      console.error("Recipe method AI gateway status", response.status);
      return failure("AI-tjenesten kunne ikke lage fremgangsmåten akkurat nå.", 502);
    }
    const text = reply?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text) {
      return failure("AI returnerte ikke tekst. Prøv igjen.", 502);
    }
    let parsed: any;
    try { parsed = JSON.parse(text.replace(/^\`\`\`json\s*/i, "").replace(/\`\`\`$/, "").trim()); }
    catch { return failure("AI returnerte et ugyldig format. Prøv igjen.", 502); }
    const steps: string[] = (Array.isArray(parsed?.steps) ? parsed.steps : [])
      .map((part: unknown) => clean(part, 1500)).filter(Boolean).slice(0, 40);
    if (steps.length < 2) {
      return failure("AI klarte ikke lage en trygg fremgangsmåte av disse ingrediensene. Kontroller listen.", 422);
    }
    return NextResponse.json({ steps }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Recipe-method request failed", err instanceof Error ? err.name : "unknown");
    return failure("AI-tjenesten svarte ikke i tide. Prøv igjen.", 504);
  }
}
