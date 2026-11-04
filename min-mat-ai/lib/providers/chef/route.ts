import { aiFailure, requestID, gatewayCategory, exceptionCategory } from "../../ai-diagnostics";
import { getVercelOidcToken } from "@vercel/oidc";
import { recordAiUsageLater } from "../../ai-usage";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type InventoryItem = {
  id?: string;
  name: string;
  quantity?: number;
  unit?: string;
  location?: string;
  expirationDate?: string | null;
};

type ChefRequest = {
  action?: "ideas" | "use_soon" | "dinner" | "weekly_plan" | "daily_plan" | "single_meal" | "freeform";
  mealSlot?: string;
  language?: string;
  servings?: number;
  maxMinutes?: number;
  allowMissing?: boolean;
  message?: string;
  // Only the recipe library requires a recipe from a freeform request.
  responseMode?: "conversation" | "recipe";
  imageDataURL?: string;
  recentMeals?: string[];
  preferences?: {
    allergies?: string;
    diet?: string;
    dislikes?: string;
  };
  inventory?: InventoryItem[];
};

const allowedUnits = ["stk", "skive", "mg", "g", "hg", "kg", "ml", "dl", "l", "ts", "ss"];

type RateEntry = { count: number; resetAt: number };
const globalRateStore = globalThis as typeof globalThis & { __minMatChefRate?: Map<string, RateEntry> };
const rateStore = globalRateStore.__minMatChefRate ?? new Map<string, RateEntry>();
globalRateStore.__minMatChefRate = rateStore;

function rateLimitKey(request: NextRequest) {
  const installation = request.headers.get("x-minmat-installation")?.trim();
  if (installation && /^[a-f0-9-]{20,80}$/i.test(installation)) return "install:" + installation.toLowerCase();
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return "ip:" + (forwarded || request.headers.get("x-real-ip") || "unknown");
}

function consumeRateLimit(request: NextRequest) {
  const key = rateLimitKey(request);
  const now = Date.now();
  const current = rateStore.get(key);
  if (!current || current.resetAt <= now) {
    rateStore.set(key, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return true;
  }
  if (current.count >= 60) return false;
  current.count += 1;
  rateStore.set(key, current);
  return true;
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function cleanString(value: unknown, max = 300) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function sanitizeInventory(input: unknown): InventoryItem[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 80).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const name = cleanString(item.name, 120);
    if (!name) return [];
    const quantity = Number(item.quantity);
    const unit = cleanString(item.unit, 12);
    return [{
      id: cleanString(item.id, 80) || undefined,
      name,
      quantity: Number.isFinite(quantity) ? Math.max(0, Math.min(quantity, 100000)) : undefined,
      unit: allowedUnits.includes(unit) ? unit : "stk",
      location: cleanString(item.location, 80) || undefined,
      expirationDate: cleanString(item.expirationDate, 40) || null
    }];
  });
}

function stripCodeFence(text: string) {
  const fence = String.fromCharCode(96, 96, 96);
  let value = text.trim();
  if (value.toLowerCase().startsWith(fence + "json")) value = value.slice(fence.length + 4).trim();
  else if (value.startsWith(fence)) value = value.slice(fence.length).trim();
  if (value.endsWith(fence)) value = value.slice(0, -fence.length).trim();
  return value;
}

function normalizeUnit(value: unknown, raw?: Record<string, unknown>) {
  const unit = cleanString(value, 12).toLowerCase();
  if (allowedUnits.includes(unit)) return unit;
  for (const candidate of allowedUnits) {
    if (raw && Object.prototype.hasOwnProperty.call(raw, candidate)) return candidate;
  }
  return "stk";
}

function normalizeAmount(value: unknown, fallback = 1) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 100000) : fallback;
}

function normalizeIngredient(raw: unknown, inventoryIds: Set<string>, allowImageInventory: boolean) {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const name = cleanString(item.name, 120);
  if (!name) return null;
  const inventoryItemID = cleanString(item.inventoryItemID, 80);
  const modelSaysAvailable = item.fromInventory === true;
  const fromInventory = modelSaysAvailable &&
    (inventoryIds.has(inventoryItemID) || (allowImageInventory && inventoryItemID === ""));
  return {
    name,
    amount: normalizeAmount(item.amount, 1),
    unit: normalizeUnit(item.unit, item),
    fromInventory,
    inventoryItemID: fromInventory && inventoryItemID !== "" ? inventoryItemID : null
  };
}

function normalizeMissingIngredient(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const name = cleanString(item.name, 120);
  if (!name) return null;
  return {
    name,
    amount: normalizeAmount(item.amount, 1),
    unit: normalizeUnit(item.unit, item)
  };
}

function normalizeSuggestion(raw: unknown, inventoryIds: Set<string>, defaultServings: number, defaultMinutes: number, allowImageInventory: boolean) {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const title = cleanString(item.title, 140);
  if (!title) return null;
  const ingredients = Array.isArray(item.ingredients)
    ? item.ingredients.map((x) => normalizeIngredient(x, inventoryIds, allowImageInventory)).filter(Boolean).slice(0, 16)
    : [];
  const missingIngredients = Array.isArray(item.missingIngredients)
    ? item.missingIngredients.map(normalizeMissingIngredient).filter(Boolean).slice(0, 12)
    : [];
  const steps = Array.isArray(item.steps)
    ? item.steps.map((x) => cleanString(x, 500)).filter(Boolean).slice(0, 10)
    : [];
  if (steps.length === 0) return null; // Tom fremgangsmåte er ikke en brukbar oppskrift.
  const tags = Array.isArray(item.tags)
    ? item.tags.map((x) => cleanString(x, 50)).filter(Boolean).slice(0, 8)
    : [];
  const useSoon = Array.isArray(item.useSoon)
    ? item.useSoon.map((x) => cleanString(x, 120)).filter(Boolean).slice(0, 8)
    : [];
  return {
    title,
    summary: cleanString(item.summary, 500),
    servings: clampInt(item.servings, 1, 12, defaultServings),
    minutes: clampInt(item.minutes, 1, 240, defaultMinutes),
    ingredients,
    missingIngredients,
    steps,
    tags,
    useSoon
  };
}

export async function POST(request: NextRequest) {
  const id = requestID(request);
  const fail = (message: string, status: number, category: Parameters<typeof aiFailure>[4]) => aiFailure(id, "chef", message, status, category);
  try {
    const expectedClientToken = process.env.MIN_MAT_CLIENT_TOKEN;
    const suppliedClientToken = request.headers.get("x-minmat-client");
    if (!expectedClientToken || suppliedClientToken !== expectedClientToken) {
      return fail("Ugyldig klient.", 401, "client_auth");
    }

    if (!consumeRateLimit(request)) {
      return fail("For mange AI-Kokk-forespørsler akkurat nå. Prøv igjen litt senere.", 429, "gateway_rate_limit");
    }

    const contentLength = Number(request.headers.get("content-length") || "0");
    if (contentLength > 1500000) {
      return fail("Forespørselen er for stor.", 413, "invalid_input");
    }

    let raw: ChefRequest;
    try { raw = await request.json(); }
    catch { return fail("Ugyldig forespørsel.", 400, "invalid_input"); }
    if (!raw || typeof raw !== "object") return fail("Ugyldig forespørsel.", 400, "invalid_input");
    const inventory = sanitizeInventory(raw.inventory);
    const validActions = ["ideas", "use_soon", "dinner", "weekly_plan", "daily_plan", "single_meal", "freeform"];
    const action = validActions.includes(raw.action || "") ? String(raw.action) : "ideas";
    const servings = clampInt(raw.servings, 1, 12, 2);
    const maxMinutes = clampInt(raw.maxMinutes, 10, 180, 35);
    const allowMissing = raw.allowMissing !== false;
    const language = cleanString(raw.language, 16) || "nb";
    const validSlots = ["frokost", "lunsj", "mellommåltid", "middag", "kveld"];
    const mealSlot = validSlots.includes(raw.mealSlot || "") ? raw.mealSlot : "middag";
    const message = cleanString(raw.message, 1000);
    // Only upgraded clients explicitly requesting conversation may receive text alone.
    // Older clients and the recipe editor still require actual recipe suggestions.
    const responseMode = action === "freeform" && raw.responseMode === "conversation" ? "conversation" : "recipe";
    const imageDataURL = typeof raw.imageDataURL === "string" &&
      raw.imageDataURL.startsWith("data:image/jpeg;base64,") &&
      raw.imageDataURL.length <= 1200000
      ? raw.imageDataURL
      : "";
    const allergies = cleanString(raw.preferences?.allergies, 500);
    const diet = cleanString(raw.preferences?.diet, 300);
    const dislikes = cleanString(raw.preferences?.dislikes, 300);
    const recentMeals = Array.isArray(raw.recentMeals)
      ? raw.recentMeals.map((x) => cleanString(x, 140)).filter(Boolean).slice(0, 8)
      : [];

    if (inventory.length === 0 && !message && !imageDataURL) {
      return fail("Legg inn mat i matlageret eller skriv hva du ønsker hjelp med.", 400, "invalid_input");
    }

    let token: string | undefined;
    try { token = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || await getVercelOidcToken(); }
    catch { return fail("AI-tjenesten er ikke konfigurert.", 503, "gateway_auth"); }
    if (!token) {
      return fail("AI-tjenesten er ikke konfigurert.", 503, "gateway_auth");
    }

    const actionInstruction: Record<string, string> = {
      ideas: "Lag 3 gode og realistiske forslag som bruker mest mulig av matlageret.",
      use_soon: "Prioriter mat med nær utløpsdato. Lag 3 forslag som reduserer matsvinn.",
      dinner: "Lag 3 middagsforslag som passer tidsgrensen.",
      weekly_plan: "Lag en variert 7-dagers middagsplan. Returner 7 forslag og fyll mealPlan med dayOffset 0-6.",
      daily_plan: "Lag en komplett, variert dagsmeny for én dag med FEM forslag i denne rekkefølgen: frokost, lunsj, mellommåltid, middag, kveldsmat. Fyll mealPlan med fem oppføringer, alle dayOffset 0, og slot nøyaktig: frokost, lunsj, mellommåltid, middag, kveld. Sjekk at ingrediensene samlet sett står i rimelig forhold til matlageret.",
      single_meal: "Lag NØYAKTIG ÉTT komplett og realistisk måltid til måltidstypen " + mealSlot + ". Returner én suggestion og mealPlan: [].",
      freeform: responseMode === "recipe"
        ? "Lag minst én fullstendig oppskrift med ingredienser og fremgangsmåte. Du må returnere en gyldig suggestion."
        : "Svar direkte på brukerens matspørsmål. Vanlige spørsmål kan besvares kun i answer, med suggestions: [] og mealPlan: []. Lag fullstendige suggestions bare når brukeren faktisk ber om en oppskrift."
    };

    const system = [
      "Du er AI-Kokk i appen Min Mat. Du skal være praktisk, nøktern og flink til å bruke det brukeren allerede har hjemme.",
      "Svar på språk-koden " + language + ". Bruk vanlige matvarer og realistiske mengder.",
      "Du skal aldri late som om en vare finnes dersom den ikke finnes i inventory. Respekter også oppgitt mengde så langt det er praktisk mulig. Hvis allowMissing er false skal du bruke bare inventory og missingIngredients skal være tom. Hvis allowMissing er true kan nødvendige manglende varer føres under missingIngredients.",
      "Hvis et bilde er vedlagt, kan tydelig synlige matvarer regnes som tilgjengelige og markeres fromInventory=true med inventoryItemID=null. Ikke gjett på uklare eller skjulte varer.",
      "Ved oppgitte allergier skal du unngå ingredienser som åpenbart bryter med dem, men aldri garantere at en rett er allergenfri. Hold rådene matfaglige og ikke medisinske.",
      "Hvis recentMeals er oppgitt, varier forslagene og unngå å gjenta disse rettene unødvendig. Gjenta bare når brukeren ber om det eller det er klart mest hensiktsmessig.",
      "Tillatte unit-verdier er kun: " + allowedUnits.join(", ") + ".",
      "Returner KUN gyldig JSON, uten markdown eller forklarende tekst utenfor JSON.",
      "For freeform-spørsmål om mat, råvarer, ernæring, sukker, fett, tilberedning og oppbevaring: svar i answer. Bruk suggestions: [] og mealPlan: [] når ingen oppskrift etterspørres.",
      "For freeform-spørsmål som ber om en ny oppskrift eller konkret oppskriftsendring: returner en fullstendig oppskrift i suggestions, også når du forklarer noe i answer.",
      "For alle andre handlinger enn freeform må suggestions inneholde ferdige, brukbare oppskrifter. Ikke erstatt måltidsforslag med tekst alene.",
      "Når brukeren spør om eksakt næringsinnhold i et bestemt merkeprodukt: du har ikke tilgang til levende varedeklarasjoner. Ikke oppgi oppdiktede tall. Si at produktvariant og oppdatert næringsdeklarasjon må sjekkes og be eventuelt om bilde eller etikett.",
      "Unngå medisinske diagnoser og bastante helsepåstander; gi nøktern generell matinformasjon.",
      "",
      "JSON-format:",
      "{",
      "  \"answer\": \"kort innledning\",",
      "  \"suggestions\": [",
      "    {",
      "      \"title\": \"navn på retten\",",
      "      \"summary\": \"kort beskrivelse\",",
      "      \"servings\": 2,",
      "      \"minutes\": 30,",
      "      \"ingredients\": [",
      "        { \"name\": \"ingrediens\", \"amount\": 2, \"unit\": \"stk\", \"fromInventory\": true, \"inventoryItemID\": \"id hvis sikkert kjent, ellers null\" }",
      "      ],",
      "      \"missingIngredients\": [",
      "        { \"name\": \"vare\", \"amount\": 1, \"unit\": \"stk\" }",
      "      ],",
      "      \"steps\": [\"Steg 1\", \"Steg 2\"],",
      "      \"tags\": [\"rask\", \"middag\"],",
      "      \"useSoon\": [\"vare som bør brukes snart\"]",
      "    }",
      "  ],",
      "  \"mealPlan\": [",
      "    { \"dayOffset\": 0, \"slot\": \"middag\", \"suggestionIndex\": 0 }",
      "  ]",
      "}",
      "For andre handlinger enn weekly_plan og daily_plan skal mealPlan normalt være [].",
      "Ikke returner mer enn 7 suggestions, 16 ingredienser per rett eller 10 steg per rett.",
      "Prioriter alltid en HELT FERDIG, kortfattet JSON-respons. Unngå lange introduksjoner og fylltekst.",
      "Bruk vanligvis 3-6 korte steps per rett, og 2-4 korte steps ved ukeplan eller dagsplan.",
      "For freeform er answer et selvstendig svar: skriv normalt 1-4 korte avsnitt, maksimalt 1200 tegn. For andre handlinger hold answer under 200 tegn. Hold summary under 140 tegn.",
      "Behold alle nødvendige ingredienser og konkrete tilberedningstrinn når en oppskrift er etterspurt.",
      action === "freeform" && responseMode === "conversation"
        ? "VIKTIG FOR DENNE MELDINGEN: Ved et vanlig matspørsmål, send {\"answer\":\"selvstendig svar\",\"suggestions\":[],\"mealPlan\":[]}. Ikke finn på oppskrifter hvis det ikke er bedt om dem. Ved ønske om oppskrift, inkluder fullstendig suggestions."
        : "VIKTIG FOR DENNE MELDINGEN: Returner en eller flere komplette oppskrifter i suggestions. Svar med tekst alene er ikke godkjent."
    ].join("\n");

    const userPayload = {
      instruction: actionInstruction[action],
      servings,
      mealSlot,
      maxMinutes,
      allowMissing,
      preferences: { allergies, diet, dislikes },
      message,
      responseMode,
      recentMeals,
      inventory,
      imageAttached: Boolean(imageDataURL)
    };

    const userContent: any = imageDataURL
      ? [
          { type: "text", text: JSON.stringify(userPayload) + "\nSe også på bildet og bruk synlige matvarer som støtte. Ikke anta at uklare eller skjulte varer finnes." },
          { type: "image_url", image_url: { url: imageDataURL } }
        ]
      : JSON.stringify(userPayload);

    const gatewayResponse = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "openai/gpt-5.6-luna",
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent }
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: action === "weekly_plan" ? 5000 : action === "daily_plan" ? 4400 : 3200
      }),
      signal: AbortSignal.timeout(80000)
    });

    let gatewayBody: any;
    try { gatewayBody = await gatewayResponse.json(); }
    catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      return fail("AI-tjenesten returnerte et uleselig svar.", 502, "invalid_json");
    }
    recordAiUsageLater("chef", gatewayResponse.status, gatewayBody, "openai/gpt-5.6-luna", token);
    if (!gatewayResponse.ok) {
      // Logg aldri feilmeldinger fra leverandøren: de kan inneholde brukerinnhold.
      return fail("AI-Kokk er midlertidig utilgjengelig.", 502, gatewayCategory(gatewayResponse.status));
    }

    const choice = gatewayBody?.choices?.[0];
    const finishReason = choice?.finish_reason;
    if (finishReason === "length") {
      // En avbrutt JSON-respons skal aldri telle som levert resultat i appens dagskvote.
      return fail("AI-Kokk rakk ikke fullføre oppskriften. Forsøket teller ikke i dagskvoten. Prøv et kortere spørsmål.", 502, "incomplete_output");
    }
    if (finishReason === "content_filter" || choice?.message?.refusal) {
      return fail("AI-Kokk kunne ikke fullføre denne forespørselen. Forsøket teller ikke i dagskvoten.", 502, "content_filter");
    }
    const content = choice?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      return fail("AI-Kokk ga ikke et gyldig svar.", 502, "invalid_result");
    }

    let parsed: any;
    try {
      parsed = JSON.parse(stripCodeFence(content));
    } catch {
      // Ikke logg rå modelltekst: den kan inneholde personopplysninger og oppskrifter.
      return fail("AI-Kokk ga et ufullstendig svar. Forsøket teller ikke i dagskvoten. Prøv igjen.", 502, "invalid_json");
    }

    const inventoryIds = new Set(inventory.map((item) => item.id).filter((id): id is string => Boolean(id)));
    let suggestions = Array.isArray(parsed?.suggestions)
      ? parsed.suggestions
          .map((item: unknown) => normalizeSuggestion(item, inventoryIds, servings, maxMinutes, Boolean(imageDataURL)))
          .filter(Boolean)
          .map((suggestion: any) => {
            const merged = new Map<string, any>();
            for (const missing of suggestion.missingIngredients || []) {
              merged.set(cleanString(missing.name, 120).toLocaleLowerCase("nb-NO"), missing);
            }
            for (const ingredient of suggestion.ingredients || []) {
              if (!ingredient.fromInventory) {
                const key = cleanString(ingredient.name, 120).toLocaleLowerCase("nb-NO");
                if (!merged.has(key)) {
                  merged.set(key, { name: ingredient.name, amount: ingredient.amount, unit: ingredient.unit });
                }
              }
            }
            return { ...suggestion, missingIngredients: Array.from(merged.values()).slice(0, 12) };
          })
          .filter((suggestion: any) => allowMissing || suggestion.missingIngredients.length === 0)
          .slice(0, 7)
      : [];
    if (!allowMissing) {
      suggestions = suggestions.map((suggestion: any) => ({
        ...suggestion,
        ingredients: suggestion.ingredients.filter((ingredient: any) => ingredient.fromInventory === true),
        missingIngredients: []
      }));
    }
    let mealPlan = Array.isArray(parsed?.mealPlan)
      ? parsed.mealPlan.flatMap((raw: unknown) => {
          if (!raw || typeof raw !== "object") return [];
          const entry = raw as Record<string, unknown>;
          const suggestionIndex = clampInt(entry.suggestionIndex, 0, Math.max(0, suggestions.length - 1), 0);
          const dayOffset = clampInt(entry.dayOffset, 0, 6, 0);
          const slot = cleanString(entry.slot, 30).toLowerCase() || "middag";
          return suggestions.length > 0 ? [{ dayOffset, slot, suggestionIndex }] : [];
        }).slice(0, 7)
      : [];
    if (action === "daily_plan" && suggestions.length > 0) {
      const slots = ["frokost", "lunsj", "mellommåltid", "middag", "kveld"];
      // Map deterministically when the model omits or scrambles mealPlan indexes.
      mealPlan = slots.slice(0, suggestions.length).map((slot, suggestionIndex) => ({
        dayOffset: 0, slot, suggestionIndex
      }));
    }
    if (action === "single_meal") suggestions = suggestions.slice(0, 1);

    const answer = cleanString(parsed?.answer, 1200);
    // Text-only is a usable result only for freeform conversation, never for
    // meals or for the dedicated recipe-editor flow.
    const validTextOnly = action === "freeform" && responseMode !== "recipe" &&
      suggestions.length === 0 && answer.length > 0 &&
      // Do not turn a malformed/filtered recipe into a billable text answer.
      Array.isArray(parsed?.suggestions) && parsed.suggestions.length === 0 &&
      Array.isArray(parsed?.mealPlan) && parsed.mealPlan.length === 0;
    if (suggestions.length === 0 && !validTextOnly) {
      return fail("AI-Kokk fant ingen brukbare forslag. Prøv igjen.", 502, "no_suggestions");
    }
    if (validTextOnly) mealPlan = [];

    return NextResponse.json(
      {
        answer,
        suggestions,
        mealPlan,
        model: gatewayBody?.model || "openai/gpt-5.6-luna"
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    // Ikke logg hele unntaket, som kan inneholde brukerinnhold eller leverandørdata.
    return fail("Kunne ikke kontakte AI-Kokk akkurat nå.", 502, exceptionCategory(error));
  }
}

