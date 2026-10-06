import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { ok: true, service: "min-mat-ai", model: "openai/gpt-5.6-sol" },
    { headers: { "Cache-Control": "no-store" } }
  );
}
