import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("key") !== "final35") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const clientToken = process.env.MIN_MAT_CLIENT_TOKEN;
  if (!clientToken) return NextResponse.json({ error: "missing test token" }, { status: 500 });

  const response = await fetch(request.nextUrl.origin + "/api/chef", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-MinMat-Client": clientToken
    },
    body: JSON.stringify({
      action: "use_soon",
      language: "nb",
      servings: 2,
      maxMinutes: 25,
      allowMissing: true,
      message: "",
      preferences: { allergies: "", diet: "", dislikes: "" },
      inventory: [
        { id: "test-egg", name: "Egg", quantity: 4, unit: "stk", location: "Kjøleskap", expirationDate: "2026-10-07T12:00:00Z" },
        { id: "test-potato", name: "Poteter", quantity: 600, unit: "g", location: "Matbod", expirationDate: null }
      ]
    })
  });
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
