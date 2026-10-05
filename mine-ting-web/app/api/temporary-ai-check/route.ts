import { NextResponse } from "next/server";
import { getVercelOidcToken } from "@vercel/oidc";

export const runtime = "nodejs";

async function testModel(model: string, token: string) {
  const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2D+IAAAAASUVORK5CYII=";
  const response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Dette er en teknisk helsesjekk. Svar kun OK." },
          { type: "image_url", image_url: { url: image, detail: "low" } }
        ]
      }],
      max_tokens: 8,
      stream: false
    })
  });
  const data = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    errorType: data?.error?.type || null,
    errorMessage: data?.error?.message || null,
    answered: Boolean(data?.choices?.[0]?.message?.content),
    returnedModel: data?.model || null
  };
}

export async function GET() {
  try {
    const token = process.env.AI_GATEWAY_API_KEY || await getVercelOidcToken();
    if (!token) return NextResponse.json({ ok:false, auth:false }, { status:503 });

    const candidates = [
      "google/gemini-3.5-flash-lite",
      "google/gemini-3.6-flash",
      "openai/gpt-5.6-luna"
    ];

    const results: Record<string, unknown> = {};
    for (const model of candidates) {
      const result = await testModel(model, token);
      results[model] = result;
      if (result.ok) break;
    }

    const workingModel = Object.entries(results).find(([, value]: any) => value?.ok)?.[0] || null;
    return NextResponse.json({
      ok: Boolean(workingModel),
      auth:true,
      workingModel,
      results
    }, { status: workingModel ? 200 : 502 });
  } catch (error) {
    return NextResponse.json({
      ok:false,
      error:error instanceof Error ? error.message : "unknown"
    }, { status:500 });
  }
}
