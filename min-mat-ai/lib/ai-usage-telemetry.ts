import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { after } from "next/server";

export type AIFeature = "chef" | "inventory-photo" | "recipe-method" | "recipe-image";

type GatewayReply = Record<string, unknown> | null;

// Only metadata is retained. Never store prompts, images, recipes, IP addresses,
// user identifiers, request headers or authorization tokens in the usage ledger.
export function captureAIMetrics(feature: AIFeature, response: Response, reply: GatewayReply, authToken: string) {
  const databaseURL = process.env.MIN_MAT_IMAGE_LIMITS_DATABASE_URL;
  if (!databaseURL) return;

  const id = randomUUID();
  const status = response.status;
  const rawModel = typeof reply?.model === "string" ? reply.model : "";
  const model = rawModel.slice(0, 100) || (feature === "recipe-image" ? "openai/gpt-image-2" : "openai/gpt-5.6-luna");
  const usage = reply?.usage && typeof reply.usage === "object" ? reply.usage as Record<string, unknown> : {};
  const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
  const inputTokens = count(usage.prompt_tokens);
  const outputTokens = count(usage.completion_tokens);
  const generationId = typeof reply?.id === "string" && /^gen_[A-Za-z0-9_-]{8,100}$/.test(reply.id)
    ? reply.id : null;

  // The AI request has already completed; telemetry must never delay or break the app response.
  after(async () => {
    try {
      const sql = neon(databaseURL);
      await sql`
        INSERT INTO public.mine_mat_ai_usage
          (id, feature, model, gateway_status, generation_id, input_tokens, output_tokens, cost_usd)
        VALUES
          (${id}, ${feature}, ${model}, ${status}, ${generationId}, ${inputTokens}, ${outputTokens}, NULL)
        ON CONFLICT (id) DO NOTHING
      `;

      if (!generationId || !authToken) return;
      // Gateway bookkeeping can lag behind the request; try once, then a short retry.
      for (const pauseMs of [0, 1000, 1800]) {
        if (pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
        const url = "https://ai-gateway.vercel.sh/v1/generation?id=" + encodeURIComponent(generationId);
        const response = await fetch(url, {
          headers: { Authorization: "Bearer " + authToken, Accept: "application/json" },
          cache: "no-store",
          signal: AbortSignal.timeout(3500)
        });
        if (response.status === 404) continue;
        if (!response.ok) break;
        const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
        const obj = payload?.data && typeof payload.data === "object"
          ? payload.data as Record<string, unknown> : payload;
        const value = obj?.totalCost;
        const amount = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
        if (Number.isFinite(amount) && amount >= 0 && amount < 1_000) {
          await sql`UPDATE public.mine_mat_ai_usage SET cost_usd = ${amount}
            WHERE id = ${id} AND cost_usd IS NULL`;
        }
        break;
      }
    } catch (error) {
      // Best effort only: no user data or credential is logged.
      console.warn("Min Mat AI usage recording unavailable", error instanceof Error ? error.name : "unknown");
    }
  });
}
