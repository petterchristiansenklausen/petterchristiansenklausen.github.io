import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import type { NextRequest } from "next/server";

export type TextAIService = "chef" | "inventory-photo" | "recipe-method";

const DAILY_VISITOR_DEFAULTS: Record<TextAIService, number> = {
  chef: 20,
  "inventory-photo": 10,
  "recipe-method": 20
};

const DAILY_VISITOR_ENV: Record<TextAIService, string> = {
  chef: "MIN_MAT_CHEF_DAILY_PER_VISITOR",
  "inventory-photo": "MIN_MAT_INVENTORY_DAILY_PER_VISITOR",
  "recipe-method": "MIN_MAT_METHOD_DAILY_PER_VISITOR"
};

function configuredLimit(value: string | undefined, fallback: number, maximum: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : fallback;
}

/**
 * Reserves one text-AI call before invoking AI Gateway.
 *
 * Uses the existing recipe_image_quota table: atomic INSERT .. ON CONFLICT
 * counters shared across Vercel instances. No installation ID is trusted.
 * The global monthly bucket bounds the total number of requests even if
 * somebody obtains the reusable client token or changes IP addresses.
 *
 * Important: this is an abuse/cost guard, NOT an authenticated paid-credit
 * ledger. Gateway spend budgets must also be configured separately.
 */
export async function reserveTextAIQuota(
  request: NextRequest,
  service: TextAIService
): Promise<boolean> {
  const connection = process.env.MIN_MAT_IMAGE_LIMITS_DATABASE_URL;
  const salt = process.env.MIN_MAT_IMAGE_LIMIT_SALT;
  if (!connection || !salt || salt.length < 24) {
    throw new Error("AI_TEXT_QUOTA_NOT_CONFIGURED");
  }

  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const month = day.slice(0, 7);

  // Client-supplied x-minmat-installation is not proof of identity.
  // Vercel's forwarded client IP is hashed with a server-side secret;
  // raw IP addresses are never written to our quota table.
  const ip = (request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") || "unknown").split(",")[0].trim().slice(0, 80);
  const visitor = createHash("sha256").update(salt + ":" + day + ":" + ip)
    .digest("hex").slice(0, 32);

  const visitorKey = "minmat:text:" + service + ":visitor:" + day + ":" + visitor;
  const globalKey = "minmat:text:all:month:" + month;

  const visitorLimit = configuredLimit(
    process.env[DAILY_VISITOR_ENV[service]],
    DAILY_VISITOR_DEFAULTS[service],
    100
  );
  const globalLimit = configuredLimit(
    process.env.MIN_MAT_TEXT_AI_MONTHLY_LIMIT, 250, 10000
  );

  // Allow the monthly counter to increment only for requests which pass the
  // daily visitor check. A failed global check can consume one visitor slot,
  // which is conservative and cannot increase AI spending.
  const statement = [
    "WITH visitor AS (",
    "INSERT INTO public.recipe_image_quota (bucket, used, expires_at)",
    "VALUES ($1, 1, ($2::timestamptz + interval '3 days'))",
    "ON CONFLICT (bucket) DO UPDATE SET used = public.recipe_image_quota.used + 1",
    "WHERE public.recipe_image_quota.used < $3 RETURNING bucket",
    "), global_budget AS (",
    "INSERT INTO public.recipe_image_quota (bucket, used, expires_at)",
    "SELECT $4, 1, ($5::timestamptz + interval '45 days') FROM visitor",
    "ON CONFLICT (bucket) DO UPDATE SET used = public.recipe_image_quota.used + 1",
    "WHERE public.recipe_image_quota.used < $6 RETURNING bucket",
    ") SELECT EXISTS(SELECT 1 FROM global_budget) AS allowed"
  ].join(" ");

  const sql = neon(connection);
  const rows = await sql.query(statement, [
    visitorKey, day + "T00:00:00Z", visitorLimit,
    globalKey, month + "-01T00:00:00Z", globalLimit
  ]);
  return rows[0]?.allowed === true;
}
