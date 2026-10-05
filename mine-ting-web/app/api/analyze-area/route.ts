import { NextResponse } from "next/server";
import { getVercelOidcToken } from "@vercel/oidc";

export const runtime = "nodejs";

const BACKEND_URL = process.env.NEXT_PUBLIC_MINE_TING_API_URL || "";
const PRIMARY_MODEL = "openai/gpt-5.6-luna";
const FALLBACK_MODEL = "openai/gpt-5.6-sol";

function cleanJson(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  return JSON.parse(cleaned);
}

function paymentRequired(data: any) {
  return data?.error?.type === "customer_verification_required";
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const token = String(body.token || "");
    const rawImages = Array.isArray(body.images) ? body.images : [body.image];
    const images = rawImages
      .map((value: unknown) => String(value || ""))
      .filter((value: string) => value.startsWith("data:image/"))
      .slice(0, 4);

    if (!token) return NextResponse.json({ ok: false, error: "Logg inn for å bruke områdeskanning." }, { status: 401 });
    if (!images.length) return NextResponse.json({ ok: false, error: "Ta minst ett bilde av skuffen, hyllen eller området." }, { status: 400 });
    if (images.reduce((sum: number, value: string) => sum + value.length, 0) > 16_000_000) {
      return NextResponse.json({ ok: false, error: "Bildene er for store. Prøv færre eller mindre bilder." }, { status: 413 });
    }
    if (!BACKEND_URL) return NextResponse.json({ ok: false, error: "Synkroniseringstjenesten er ikke konfigurert." }, { status: 503 });

    const statusResponse = await fetch(`${BACKEND_URL}/ai/status`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    const statusData = await statusResponse.json().catch(() => ({}));

    if (!statusResponse.ok) {
      return NextResponse.json({
        ok: false,
        error: statusData.error || "AI-analyse er ikke tilgjengelig.",
        code: statusData.code
      }, { status: statusResponse.status });
    }

    if (Number(statusData.serviceRemaining ?? 1) <= 0) {
      return NextResponse.json({
        ok: false,
        error: "AI-budsjettet for Mine Ting er brukt opp for denne måneden. Tjenesten åpnes automatisk igjen neste måned.",
        code: "AI_SERVICE_LIMIT_REACHED"
      }, { status: 503 });
    }

    if (Number(statusData.remaining ?? 0) <= 0) {
      const error = statusData.plan === "pro"
        ? "Du har brukt de 100 inkluderte Pro-analysene denne måneden."
        : "Du har brukt de 3 gratis AI-analysene denne måneden. Pro gir 100 analyser per måned.";
      return NextResponse.json({ ok: false, error, code: "AI_LIMIT_REACHED" }, { status: 402 });
    }

    const gatewayToken = process.env.AI_GATEWAY_API_KEY || await getVercelOidcToken();
    if (!gatewayToken) {
      return NextResponse.json({ ok: false, error: "AI-tjenesten mangler autentisering." }, { status: 503 });
    }

    const prompt = `
Du analyserer ett eller flere bilder av SAMME OMRÅDE for den norske appen Mine Ting.
Området kan være en skuff, bokhylle, kasse, skap, arbeidsbenk eller lignende.
Målet er å foreslå separate fysiske gjenstander som brukeren sannsynligvis ønsker å registrere.

Viktige regler:
- Returner BARE gyldig JSON, uten markdown.
- Finn opptil 25 tydelig synlige, meningsfulle gjenstander.
- Ikke lag en post for små deler som åpenbart hører til en annen gjenstand.
- Ikke dupliser samme gjenstand hvis den vises i flere bilder.
- Ikke finn på merke eller modell. Bruk tom streng hvis det ikke kan leses eller gjenkjennes med rimelig sikkerhet.
- Hvis flere like ting tydelig finnes, kan du enten lage separate poster når de er lett å skille, eller én post med quantity > 1.
- Velg kategori fra: Elektronikk, Verktøy, Møbler, Kjøkken, Samling, Klær, Sport, Hobby, Annet.
- confidence skal være et tall mellom 0 og 1.
- locationHint beskriver hvor i bildet/området gjenstanden ligger, for eksempel "øverst til venstre", "andre hylle" eller "bak i skuffen".
- notes skal være kort og bare beskrive det som faktisk kan sees.
- Prioriter nyttige identifiserbare ting fremfor emballasje, søppel eller utydelige objekter.

JSON-format:
{
  "areaLabel": "kort forslag til navn på området",
  "summary": "kort norsk oppsummering",
  "items": [
    {
      "name": "",
      "category": "Annet",
      "brand": "",
      "model": "",
      "color": "",
      "quantity": 1,
      "confidence": 0.0,
      "locationHint": "",
      "notes": ""
    }
  ]
}
`.trim();

    async function callModel(model: string) {
      const response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${gatewayToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: prompt },
              ...images.map((image: string) => ({ type: "image_url", image_url: { url: image, detail: "auto" } }))
            ]
          }],
          response_format: { type: "json_object" },
          max_tokens: 2600,
          stream: false
        })
      });

      const data = await response.json().catch(() => ({}));
      return { response, data };
    }

    let modelUsed = PRIMARY_MODEL;
    let fallbackUsed = false;
    let { response: aiResponse, data: aiData } = await callModel(PRIMARY_MODEL);

    if (!aiResponse.ok) {
      console.error("AI Gateway Luna area error", aiResponse.status, aiData);
      if (paymentRequired(aiData)) {
        return NextResponse.json({
          ok: false,
          error: "AI er klar, men Vercel krever at et betalingskort registreres på Vercel-kontoen før AI Gateway kan brukes.",
          code: "AI_GATEWAY_PAYMENT_REQUIRED"
        }, { status: 503 });
      }

      ({ response: aiResponse, data: aiData } = await callModel(FALLBACK_MODEL));
      modelUsed = FALLBACK_MODEL;
      fallbackUsed = true;
    }

    if (!aiResponse.ok) {
      console.error("AI Gateway area fallback error", aiResponse.status, aiData);
      if (paymentRequired(aiData)) {
        return NextResponse.json({
          ok: false,
          error: "AI er klar, men Vercel krever at et betalingskort registreres på Vercel-kontoen før AI Gateway kan brukes.",
          code: "AI_GATEWAY_PAYMENT_REQUIRED"
        }, { status: 503 });
      }
      return NextResponse.json({ ok: false, error: "Kunne ikke analysere området akkurat nå. Prøv igjen." }, { status: 502 });
    }

    let text = aiData?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) {
      return NextResponse.json({ ok: false, error: "AI-en returnerte ikke et brukbart svar." }, { status: 502 });
    }

    let parsed = cleanJson(text);
    let items = Array.isArray(parsed.items) ? parsed.items.slice(0, 25) : [];
    const confidenceValues = items
      .map((item: any) => Number(item?.confidence))
      .filter((value: number) => Number.isFinite(value));
    const averageConfidence = confidenceValues.length
      ? confidenceValues.reduce((sum: number, value: number) => sum + value, 0) / confidenceValues.length
      : 0;

    if (!fallbackUsed && (!items.length || averageConfidence < 0.58)) {
      const fallback = await callModel(FALLBACK_MODEL);
      if (fallback.response.ok) {
        const fallbackText = fallback.data?.choices?.[0]?.message?.content;
        if (typeof fallbackText === "string" && fallbackText.trim()) {
          try {
            const fallbackParsed = cleanJson(fallbackText);
            const fallbackItems = Array.isArray(fallbackParsed.items) ? fallbackParsed.items.slice(0, 25) : [];
            if (fallbackItems.length || !items.length) {
              parsed = fallbackParsed;
              items = fallbackItems;
              modelUsed = FALLBACK_MODEL;
              fallbackUsed = true;
            }
          } catch {}
        }
      }
    }

    const consume = await fetch(`${BACKEND_URL}/ai/consume`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });
    const usage = await consume.json().catch(() => ({}));

    if (!consume.ok) {
      return NextResponse.json({
        ok: false,
        error: usage.error || "AI-grensen er nådd.",
        code: usage.code || "AI_LIMIT_REACHED"
      }, { status: consume.status });
    }

    return NextResponse.json({
      ok: true,
      result: {
        areaLabel: String(parsed.areaLabel || ""),
        summary: String(parsed.summary || ""),
        items
      },
      usage,
      modelUsed,
      fallbackUsed
    });
  } catch (error) {
    console.error("analyze-area route", error);
    return NextResponse.json({ ok: false, error: "Noe gikk galt under områdeskanningen." }, { status: 500 });
  }
}
