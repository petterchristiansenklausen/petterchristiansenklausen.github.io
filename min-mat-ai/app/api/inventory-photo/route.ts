import { getVercelOidcToken } from "@vercel/oidc";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const categories = ["Frukt", "Grønnsaker", "Kjøtt", "Fisk", "Meieri", "Tørrvare", "Drikke", "Brød", "Pålegg", "Snacks", "Krydder", "Annet"];
const units = ["stk", "skive", "mg", "g", "hg", "kg", "ml", "dl", "l"];

type RateEntry = { count: number; resetAt: number };
const globalPhotoRate = globalThis as typeof globalThis & { __minMatPhotoRate?: Map<string, RateEntry> };
const photoRate = globalPhotoRate.__minMatPhotoRate ?? new Map<string, RateEntry>();
globalPhotoRate.__minMatPhotoRate = photoRate;

function consumePhotoRate(request: NextRequest) {
  const key = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") || "unknown";
  const now = Date.now();
  const current = photoRate.get(key);
  if (!current || current.resetAt <= now) {
    photoRate.set(key, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return true;
  }
  if (current.count >= 30) return false;
  current.count += 1;
  photoRate.set(key, current);
  return true;
}

function clean(value: unknown, max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function stripFence(text: string) {
  const fence = String.fromCharCode(96, 96, 96);
  let value = text.trim();
  if (value.toLowerCase().startsWith(fence + "json")) value = value.slice(fence.length + 4).trim();
  else if (value.startsWith(fence)) value = value.slice(fence.length).trim();
  if (value.endsWith(fence)) value = value.slice(0, -fence.length).trim();
  return value;
}

export async function POST(request: NextRequest) {
  try {
    const expected = process.env.MIN_MAT_CLIENT_TOKEN;
    if (!expected || request.headers.get("x-minmat-client") !== expected) {
      return NextResponse.json({ error: "Ugyldig klient." }, { status: 401 });
    }

    if (!consumePhotoRate(request)) {
      return NextResponse.json({ error: "For mange bildeanalyser akkurat nå. Prøv igjen litt senere." }, { status: 429 });
    }

    const length = Number(request.headers.get("content-length") || "0");
    if (length > 1500000) return NextResponse.json({ error: "Bildet er for stort." }, { status: 413 });

    const body = await request.json() as { imageDataURL?: string; existingNames?: string[]; language?: string };
    const image = typeof body.imageDataURL === "string" &&
      body.imageDataURL.startsWith("data:image/jpeg;base64,") &&
      body.imageDataURL.length <= 1200000 ? body.imageDataURL : "";
    if (!image) return NextResponse.json({ error: "Mangler gyldig bilde." }, { status: 400 });

    const existingNames = Array.isArray(body.existingNames)
      ? body.existingNames.map((x) => clean(x, 120)).filter(Boolean).slice(0, 100)
      : [];
    const language = clean(body.language, 16) || "nb";

    const token = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || await getVercelOidcToken();
    if (!token) return NextResponse.json({ error: "AI-tjenesten er ikke konfigurert." }, { status: 503 });

    const instructions = [
      "Du analyserer et bilde for appen Min Mat.",
      "Finn bare mat- og drikkevarer som er tydelig synlige. Ikke gjett på skjulte eller uklare varer.",
      "Svar på språk-koden " + language + ".",
      "Hvis en tydelig pakningsmengde kan leses, bruk den. Ellers bruk quantity 1 og unit stk.",
      "Kategori må være én av: " + categories.join(", ") + ".",
      "Unit må være én av: " + units.join(", ") + ".",
      "Unngå duplikater. existingNames er bare hjelp til navngiving, ikke bevis på at varen finnes på bildet.",
      "Returner kun JSON: {\"items\":[{\"name\":\"Lettmelk\",\"quantity\":1,\"unit\":\"l\",\"category\":\"Meieri\",\"confidence\":0.95}],\"note\":\"kort tekst\"}.",
      "Maks 20 varer. confidence skal være 0 til 1."
    ].join("\n");

    const gateway = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-5.6-luna",
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: [
            { type: "text", text: JSON.stringify({ existingNames }) },
            { type: "image_url", image_url: { url: image } }
          ] }
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 1800
      }),
      signal: AbortSignal.timeout(28000)
    });

    const gatewayBody = await gateway.json().catch(() => null) as any;
    if (!gateway.ok) {
      console.error("inventory photo gateway error", gateway.status, gatewayBody?.error?.message);
      return NextResponse.json({ error: "Kunne ikke analysere bildet akkurat nå." }, { status: 502 });
    }

    const content = gatewayBody?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return NextResponse.json({ error: "AI ga ikke et gyldig svar." }, { status: 502 });

    let parsed: any;
    try { parsed = JSON.parse(stripFence(content)); }
    catch { return NextResponse.json({ error: "AI-svaret kunne ikke leses." }, { status: 502 }); }

    const items = Array.isArray(parsed?.items) ? parsed.items.flatMap((raw: any) => {
      if (!raw || typeof raw !== "object") return [];
      const name = clean(raw.name, 120);
      if (!name) return [];
      const quantityValue = Number(raw.quantity);
      const quantity = Number.isFinite(quantityValue) && quantityValue > 0 ? Math.min(quantityValue, 100000) : 1;
      const unitRaw = clean(raw.unit, 12).toLowerCase();
      const unit = units.includes(unitRaw) ? unitRaw : "stk";
      const categoryRaw = clean(raw.category, 60);
      const category = categories.includes(categoryRaw) ? categoryRaw : "Annet";
      const confidenceValue = Number(raw.confidence);
      const confidence = Number.isFinite(confidenceValue) ? Math.max(0, Math.min(1, confidenceValue)) : 0.5;
      if (confidence < 0.45) return [];
      return [{ name, quantity, unit, category, confidence }];
    }).slice(0, 20) : [];

    return NextResponse.json({
      items,
      note: clean(parsed?.note, 400),
      model: gatewayBody?.model || "openai/gpt-5.6-luna"
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("inventory photo failed", error);
    return NextResponse.json({ error: "Kunne ikke analysere bildet akkurat nå." }, { status: 500 });
  }
}
