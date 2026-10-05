import { NextResponse } from "next/server";
import { getVercelOidcToken } from "@vercel/oidc";

export const runtime = "nodejs";

const BACKEND_URL = process.env.NEXT_PUBLIC_MINE_TING_API_URL || "";

function cleanJson(text: string) {
  const cleaned = text.trim().replace(/^\`\`\`(?:json)?/i, "").replace(/\`\`\`$/i, "").trim();
  return JSON.parse(cleaned);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const token = String(body.token || "");
    const rawImages = Array.isArray(body.images) ? body.images : [body.image];
    const images = rawImages.map((value: unknown) => String(value || "")).filter((value: string) => value.startsWith("data:image/")).slice(0, 6);

    if (!token) return NextResponse.json({ ok: false, error: "Logg inn for å bruke AI-gjenkjenning." }, { status: 401 });
    if (!images.length) return NextResponse.json({ ok: false, error: "Bildet mangler eller har feil format." }, { status: 400 });
    if (images.reduce((sum: number, value: string) => sum + value.length, 0) > 15_000_000) return NextResponse.json({ ok: false, error: "Bildene er for store. Prøv færre eller mindre bilder." }, { status: 413 });
    if (!BACKEND_URL) return NextResponse.json({ ok: false, error: "Synkroniseringstjenesten er ikke konfigurert." }, { status: 503 });

    const statusResponse = await fetch(`${BACKEND_URL}/ai/status`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    const statusData = await statusResponse.json().catch(() => ({}));
    if (!statusResponse.ok) {
      return NextResponse.json({ ok: false, error: statusData.error || "AI-analyse er ikke tilgjengelig.", code: statusData.code }, { status: statusResponse.status });
    }
    if (statusData.limit !== null && Number(statusData.remaining || 0) <= 0) {
      return NextResponse.json({ ok: false, error: "Du har brukt de gratis AI-analysene denne måneden. Oppgrader til Pro for flere.", code: "AI_LIMIT_REACHED" }, { status: 402 });
    }

    const gatewayToken = process.env.AI_GATEWAY_API_KEY || await getVercelOidcToken();
    if (!gatewayToken) return NextResponse.json({ ok: false, error: "AI-tjenesten mangler autentisering." }, { status: 503 });

    const prompt = `
Du analyserer ett eller flere bilder av DEN SAMME gjenstanden for den norske appen Mine Ting.
Bruk alle bildene samlet. Ett bilde kan vise hele gjenstanden, mens andre kan vise etikett, underside, serienummer, modellnummer eller skader.
Finn hovedgjenstanden og returner BARE gyldig JSON, uten markdown.

Regler:
- Ikke gjett merke eller modell hvis det ikke kan leses eller kjennes igjen med rimelig sikkerhet.
- Hvis merke/modell er usikkert, bruk tom streng.
- Velg kategori fra: Elektronikk, Verktøy, Møbler, Kjøkken, Samling, Klær, Sport, Hobby, Annet.
- conditionSuggestion må være én av: Som ny, Pent brukt, Brukt, Godt brukt.
- title skal være et kort norsk navn brukeren kan forstå.
- saleTitle og saleDescription skal være et nøkternt annonseutkast på norsk, men ikke finn på tekniske data.
- notes skal fortelle hva du faktisk ser, og hva brukeren eventuelt bør kontrollere selv.
- confidence skal være et tall mellom 0 og 1.

JSON-format:
{
  "title": "",
  "genericName": "",
  "category": "Annet",
  "brand": "",
  "model": "",
  "color": "",
  "conditionSuggestion": "Brukt",
  "confidence": 0.0,
  "keywords": [],
  "notes": "",
  "saleTitle": "",
  "saleDescription": ""
}
`.trim();

    const aiResponse = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${gatewayToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "openai/gpt-5.6-sol",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            ...images.map((image: string) => ({ type: "image_url", image_url: { url: image, detail: "auto" } }))
          ]
        }],
        response_format: { type: "json_object" },
        stream: false
      })
    });

    const aiData = await aiResponse.json().catch(() => ({}));
    if (!aiResponse.ok) {
      console.error("AI Gateway error", aiResponse.status, aiData);
      if (aiData?.error?.type === "customer_verification_required") {
        return NextResponse.json({
          ok: false,
          error: "AI er klar, men Vercel krever at et betalingskort registreres på Vercel-kontoen før AI Gateway kan brukes.",
          code: "AI_GATEWAY_PAYMENT_REQUIRED"
        }, { status: 503 });
      }
      return NextResponse.json({ ok: false, error: "Kunne ikke analysere bildet akkurat nå. Prøv igjen." }, { status: 502 });
    }

    const text = aiData?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) {
      return NextResponse.json({ ok: false, error: "AI-en returnerte ikke et brukbart svar." }, { status: 502 });
    }

    const result = cleanJson(text);

    const consume = await fetch(`${BACKEND_URL}/ai/consume`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });
    const usage = await consume.json().catch(() => ({}));

    return NextResponse.json({ ok: true, result, usage: consume.ok ? usage : statusData });
  } catch (error) {
    console.error("analyze route", error);
    return NextResponse.json({ ok: false, error: "Noe gikk galt under bildeanalysen." }, { status: 500 });
  }
}
