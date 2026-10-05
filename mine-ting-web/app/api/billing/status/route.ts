import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    configured: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRO_PRICE_ID && process.env.STRIPE_WEBHOOK_SECRET),
    currency: "NOK",
    plan: "pro"
  });
}
