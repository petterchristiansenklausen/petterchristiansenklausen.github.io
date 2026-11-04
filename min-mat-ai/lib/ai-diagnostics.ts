import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

export const categories = ["client_auth", "invalid_input", "gateway_auth", "gateway_budget", "gateway_rate_limit", "gateway_rejected", "gateway_unavailable", "timeout", "network", "invalid_json", "incomplete_output", "content_filter", "no_suggestions", "invalid_image", "image_too_large", "image_budget_config", "image_budget_unavailable", "image_budget_limit", "invalid_result", "billing_failure", "release_pending"] as const;
export type AICategory = typeof categories[number];
export function safeCategory(value: unknown): AICategory {
  return categories.includes(value as AICategory) ? value as AICategory : "billing_failure";
}
export function requestID(request: Request): string {
  const value = request.headers.get("x-minmat-request-id");
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : randomUUID();
}
export function gatewayCategory(status: number): AICategory {
  if (status === 401 || status === 403) return "gateway_auth";
  if (status === 402) return "gateway_budget";
  if (status === 429) return "gateway_rate_limit";
  return status >= 500 ? "gateway_unavailable" : "gateway_rejected";
}
export function exceptionCategory(error: unknown): AICategory {
  return error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name) ? "timeout" : "network";
}
// Deliberate allowlist: never log error.message, input, headers, IDs of wallets or recipes.
export function aiLog(id: string, feature: string, category: AICategory, status: number) {
  console.warn("min_mat_ai_failure", { requestID: id, feature, category: safeCategory(category), status });
}
export function aiFailure(id: string, feature: string, error: string, status: number, category: AICategory) {
  aiLog(id, feature, category, status);
  return NextResponse.json({ error, category, requestID: id }, { status, headers: { "Cache-Control": "no-store", "X-MinMat-Request-ID": id } });
}
