import { getVercelOidcToken } from "@vercel/oidc";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type InventoryItem = {
  id?: string;
  name: string;
  quantity?: number;
  unit?: string;
  location?: string;
  expirationDate?: string | null;
};

type ChefRequest = {
  action?: "ideas" | "use_soon" | "dinner" | "weekly_plan" | "freeform";
  language?: string;
  servings?: number;
  maxMinutes?: number;
  allowMissing?: boolean;
  message?: string;
  imageDataURL?: string;
  preferences?: {
    allergies?: string;
    diet?: string;
    dislikes?: string;
  };
  inventory?: InventoryItem[];
};

const allowedUnits = ["stk", "skive", "mg", "g", "hg", "kg", "ml", "dl", "l", "ts", "ss"];

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
  const fromInventory = modelSaysAvailable && (inventoryItemID === "" || inventoryIds.has(inventoryItemID));
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
  try {
    const expectedClientToken = process.env.MIN_MAT_CLIENT_TOKEN;
    const suppliedClientToken = request.headers.get("x-minmat-client");
    if (!expectedClientToken || suppliedClientToken !== expectedClientToken) {
      return NextResponse.json({ error: "Ugyldig klient." }, { status: 401 });
    }

    const contentLength = Number(request.headers.get("content-length") || "0");
    if (contentLength > 1500000) {
      return NextResponse.json({ error: "Forespørselen er for stor." }, { status: 413 });
    }

    const raw = await request.json() as ChefRequest;
    const inventory = sanitizeInventory(raw.inventory);
    const validActions = ["ideas", "use_soon", "dinner", "weekly_plan", "freeform"];
    const action = validActions.includes(raw.action || "") ? String(raw.action) : "ideas";
    const servings = clampInt(raw.servings, 1, 12, 2);
    const maxMinutes = clampInt(raw.maxMinutes, 10, 180, 35);
    const allowMissing = raw.allowMissing !== false;
    const language = cleanString(raw.language, 16) || "nb";
    const message = cleanString(raw.message, 1000);
    const imageDataURL = typeof raw.imageDataURL === "string" &&
      raw.imageDataURL.startsWith("data:image/jpeg;base64,") &&
      raw.imageDataURL.length <= 1200000
      ? raw.imageDataURL
      : "";
    const allergies = cleanString(raw.preferences?.allergies, 500);
    const diet = cleanString(raw.preferences?.diet, 300);
    const dislikes = cleanString(raw.preferences?.dislikes, 300);

    if (inventory.length === 0 && !message && !imageDataURL) {
      return NextResponse.json(
        { error: "Legg inn mat i matlageret eller skriv hva du ønsker hjelp med." },
        { status: 400 }
      );
    }

    const token = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || await getVercelOidcToken();
    if (!token) {
      return NextResponse.json({ error: "AI-tjenesten er ikke konfigurert." }, { status: 503 });
    }

    const actionInstruction: Record<string, string> = {
      ideas: "Lag 3 gode og realistiske forslag som bruker mest mulig av matlageret.",
      use_soon: "Prioriter mat med nær utløpsdato. Lag 3 forslag som reduserer matsvinn.",
      dinner: "Lag 3 middagsforslag som passer tidsgrensen.",
      weekly_plan: "Lag en variert 7-dagers middagsplan. Returner 7 forslag og fyll mealPlan med dayOffset 0-6.",
      freeform: "Svar på brukerens konkrete ønske, men knytt svaret til matlageret når det er relevant."
    };

    const system = [
      "Du er AI-Kokk i appen Min Mat. Du skal være praktisk, nøktern og flink til å bruke det brukeren allerede har hjemme.",
      "Svar på språk-koden " + language + ". Bruk vanlige matvarer og realistiske mengder.",
      "Du skal aldri late som om en vare finnes dersom den ikke finnes i inventory. Respekter også oppgitt mengde så langt det er praktisk mulig. Hvis allowMissing er false skal du bruke bare inventory og missingIngredients skal være tom. Hvis allowMissing er true kan nødvendige manglende varer føres under missingIngredients.",
      "Hvis et bilde er vedlagt, kan tydelig synlige matvarer regnes som tilgjengelige og markeres fromInventory=true med inventoryItemID=null. Ikke gjett på uklare eller skjulte varer.",
      "Ved oppgitte allergier skal du unngå ingredienser som åpenbart bryter med dem, men aldri garantere at en rett er allergenfri. Hold rådene matfaglige og ikke medisinske.",
      "Tillatte unit-verdier er kun: " + allowedUnits.join(", ") + ".",
      "Returner KUN gyldig JSON, uten markdown eller forklarende tekst utenfor JSON.",
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
      "For andre handlinger enn weekly_plan skal mealPlan normalt være [].",
      "Ikke returner mer enn 7 suggestions, 16 ingredienser per rett eller 10 steg per rett."
    ].join("\n");

    const userPayload = {
      instruction: actionInstruction[action],
      servings,
      maxMinutes,
      allowMissing,
      preferences: { allergies, diet, dislikes },
      message,
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
        max_completion_tokens: action === "weekly_plan" ? 4000 : 2200
      }),
      signal: AbortSignal.timeout(28000)
    });

    const gatewayBody = await gatewayResponse.json().catch(() => null) as any;
    if (!gatewayResponse.ok) {
      const detail = gatewayBody?.error?.message || gatewayBody?.message || "AI Gateway error";
      console.error("AI Gateway error", gatewayResponse.status, detail);
      return NextResponse.json({ error: "AI-Kokk er midlertidig utilgjengelig." }, { status: 502 });
    }

    const content = gatewayBody?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "AI-Kokk ga ikke et gyldig svar." }, { status: 502 });
    }

    let parsed: any;
    try {
      parsed = JSON.parse(stripCodeFence(content));
    } catch {
      console.error("AI JSON parse failed", content.slice(0, 1200));
      return NextResponse.json({ error: "AI-Kokk ga et svar som ikke kunne leses." }, { status: 502 });
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
    const mealPlan = Array.isArray(parsed?.mealPlan)
      ? parsed.mealPlan.flatMap((raw: unknown) => {
          if (!raw || typeof raw !== "object") return [];
          const entry = raw as Record<string, unknown>;
          const suggestionIndex = clampInt(entry.suggestionIndex, 0, Math.max(0, suggestions.length - 1), 0);
          const dayOffset = clampInt(entry.dayOffset, 0, 6, 0);
          const slot = cleanString(entry.slot, 30).toLowerCase() || "middag";
          return suggestions.length > 0 ? [{ dayOffset, slot, suggestionIndex }] : [];
        }).slice(0, 7)
      : [];

    if (suggestions.length === 0) {
      return NextResponse.json({ error: "AI-Kokk fant ingen brukbare forslag. Prøv igjen." }, { status: 502 });
    }

    return NextResponse.json(
      {
        answer: cleanString(parsed?.answer, 1200),
        suggestions,
        mealPlan,
        model: gatewayBody?.model || "openai/gpt-5.6-luna"
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("AI Chef route failed", error);
    return NextResponse.json({ error: "Kunne ikke kontakte AI-Kokk akkurat nå." }, { status: 500 });
  }
}
