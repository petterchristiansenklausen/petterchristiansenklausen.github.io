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

function optionalTokens(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function recordAiUsageLater(
  feature: AiFeature,
  gatewayStatus: number,
  body: GatewayBody | null,
  fallbackModel: string
): void {
  const uri = process.env.MIN_MAT_TELEMETRY_DATABASE_URL;
  if (!uri) return;

  // Reduce the remote response to safe scalar fields *before* deferring work.
  const model = typeof body?.model === "string" && body.model.length <= 128
    ? body.model : fallbackModel;
  const cost = optionalMoney(body?.usage?.cost ?? body?.provider_metadata?.gateway?.cost);
  const inputTokens = optionalTokens(body?.usage?.prompt_tokens);
  const outputTokens = optionalTokens(body?.usage?.completion_tokens);
  const status = Number.isInteger(gatewayStatus) && gatewayStatus >= 100 && gatewayStatus <= 599
    ? gatewayStatus : 0;

  after(async () => {
    try {
      const sql = neon(uri);
      await sql`
        INSERT INTO public.min_mat_ai_usage
          (feature, model, gateway_status, cost_usd, input_tokens, output_tokens)
        VALUES
          (${feature}, ${model}, ${status}, ${cost}, ${inputTokens}, ${outputTokens})
      `;
    } catch {
      // Never log prompts, raw gateway responses, DB URIs or other private data.
      console.warn("min_mat_ai_telemetry_unavailable");
    }
  });
}
