import { neon } from "@neondatabase/serverless";
import { after } from "next/server";

/**
 * Optional, privacy-preserving AI accounting for Mine Apper Admin.
 * This stores only model, fixed feature category, HTTP status, token counts
 * and the price reported by Vercel AI Gateway. No prompts, images, IPs,
 * installation identifiers, client tokens or response text are stored.
 *
 * Telemetry is disabled until MIN_MAT_TELEMETRY_DATABASE_URL is configured.
 * Logging failure must NEVER break an AI response.
 */
export type AiFeature = "chef" | "inventory-photo" | "recipe-method" | "recipe-image";

type GatewayBody = {
  id?: unknown;
  model?: unknown;
  usage?: {
    cost?: unknown;
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
  };
  provider_metadata?: { gateway?: { cost?: unknown } };
};

function optionalMoney(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value))) {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 1_000_000 ? n : null;
}

function statusIsSuccess(status: number): boolean { return status >= 200 && status < 300; }

function optionalTokens(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function recordAiUsageLater(
  feature: AiFeature,
  gatewayStatus: number,
  body: GatewayBody | null,
  fallbackModel: string,
  gatewayToken?: string,
  estimatedCostUsd?: number
): void {
  const uri = process.env.MIN_MAT_TELEMETRY_DATABASE_URL;
  if (!uri) return;

  // Reduce the remote response to safe scalar fields *before* deferring work.
  const model = typeof body?.model === "string" && body.model.length <= 128
    ? body.model : fallbackModel;
  const reportedCost = optionalMoney(body?.usage?.cost ?? body?.provider_metadata?.gateway?.cost);
  const fallbackEstimate = feature === 'recipe-image' && statusIsSuccess(gatewayStatus)
    ? optionalMoney(estimatedCostUsd) : null;
  const inputTokens = optionalTokens(body?.usage?.prompt_tokens);
  const outputTokens = optionalTokens(body?.usage?.completion_tokens);
  const status = Number.isInteger(gatewayStatus) && gatewayStatus >= 100 && gatewayStatus <= 599
    ? gatewayStatus : 500;
  // The Chat Completions response ID is the official Gateway generation lookup key
  // only if it matches the documented gen_<id> format.
  const generationId = typeof body?.id === "string" &&
    /^gen_[A-Za-z0-9_-]{8,80}$/.test(body.id) ? body.id : null;

  after(async () => {
    try {
      let cost = reportedCost;
      let lookupInputTokens: number | null = null;
      let lookupOutputTokens: number | null = null;

      // Gateway often does not send USD cost inline on its REST-compatible routes.
      // Look it up server-side using the verified generation ID if available.
      // The endpoint may report 404 briefly while usage is ingested.
      if (cost === null && generationId && gatewayToken && status >= 200 && status < 300) {
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, attempt * 900));
          let response: Response;
          try {
            response = await fetch(
              "https://ai-gateway.vercel.sh/v1/generation?id=" + encodeURIComponent(generationId),
              {
                headers: { Authorization: "Bearer " + gatewayToken, Accept: "application/json" },
                cache: "no-store",
                signal: AbortSignal.timeout(4000)
              }
            );
          } catch {
            break;
          }
          if (response.status === 404) continue;
          if (!response.ok) break;
          const generation = await response.json().catch(() => null);
          cost = optionalMoney(generation?.totalCost);
          lookupInputTokens = optionalTokens(generation?.promptTokens);
          lookupOutputTokens = optionalTokens(generation?.completionTokens);
          break;
        }
      }

      const sql = neon(uri);
      // Actual cost remains NULL when unavailable; the estimate is a different field.
      // During migration an older telemetry DB can still accept the original row.
      if (fallbackEstimate !== null && cost === null) {
        try {
          await sql`
            INSERT INTO public.min_mat_ai_usage
              (feature, model, gateway_status, cost_usd, input_tokens, output_tokens, estimated_cost_usd)
            VALUES
              (${feature}, ${model}, ${status}, ${cost},
               ${inputTokens ?? lookupInputTokens}, ${outputTokens ?? lookupOutputTokens}, ${fallbackEstimate})
          `;
          return;
        } catch { /* Estimate column migration pending. Record measured fields below. */ }
      }
      await sql`
        INSERT INTO public.min_mat_ai_usage
          (feature, model, gateway_status, cost_usd, input_tokens, output_tokens)
        VALUES
          (${feature}, ${model}, ${status}, ${cost},
           ${inputTokens ?? lookupInputTokens}, ${outputTokens ?? lookupOutputTokens})
      `;
    } catch {
      // Never log secrets, prompts, raw AI replies, request IDs or database URIs.
      console.warn("min_mat_ai_telemetry_unavailable");
    }
  });
}

