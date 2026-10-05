import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const result:any = {
    backend: false,
    aiGateway: false,
    oidcPresent: Boolean(process.env.VERCEL_OIDC_TOKEN || process.env.AI_GATEWAY_API_KEY),
    stripeEnv: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET),
    time: new Date().toISOString()
  };

  try {
    const api = process.env.NEXT_PUBLIC_MINE_TING_API_URL || "";
    const response = await fetch(api + "/health", { cache: "no-store" });
    result.backend = response.ok;
    result.backendStatus = response.status;
  } catch (error) {
    result.backendError = error instanceof Error ? error.message : "backend error";
  }

  try {
    const key = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
    if (key) {
      const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2D+IAAAAASUVORK5CYII=";
      const response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "openai/gpt-5.6-sol",
          messages: [{ role: "user", content: [
            { type: "text", text: "This is a health check. Reply only OK." },
            { type: "image_url", image_url: { url: image, detail: "low" } }
          ]}],
          max_tokens: 8,
          stream: false
        })
      });
      result.aiGateway = response.ok;
      result.aiStatus = response.status;
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        result.aiError = data?.error?.message || data?.error || "AI request failed";
      }
    }
  } catch (error) {
    result.aiError = error instanceof Error ? error.message : "ai error";
  }

  return NextResponse.json(result);
}
