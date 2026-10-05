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
    answered: Boolean(data?.choices?.[0]?.message?.content)
  };
}

export async function GET() {
  try {
    const token = process.env.AI_GATEWAY_API_KEY || await getVercelOidcToken();
    if (!token) return NextResponse.json({ ok:false, auth:false }, { status:503 });

    const luna = await testModel("openai/gpt-5.6-luna", token);
    const sol = luna.ok ? await testModel("openai/gpt-5.6-sol", token) : null;

    return NextResponse.json({
      ok: luna.ok && (sol?.ok ?? false),
      auth: true,
      luna,
      sol
    }, { status: luna.ok && sol?.ok ? 200 : 502 });
  } catch (error) {
    return NextResponse.json({
      ok:false,
      error:error instanceof Error ? error.message : "unknown"
    }, { status:500 });
  }
}
