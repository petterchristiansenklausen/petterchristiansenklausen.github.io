import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("key") !== "build35-check-9Q7v") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const origin = request.nextUrl.origin;
  const response = await fetch(origin + "/api/chef", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "ideas",
      language: "nb",
      servings: 2,
      maxMinutes: 30,
      allowMissing: true,
      message: "",
      preferences: { allergies: "", diet: "", dislikes: "" },
      inventory: [
        { id: "test-1", name: "Egg", quantity: 6, unit: "stk", location: "Kjøleskap", expirationDate: null },
        { id: "test-2", name: "Brød", quantity: 1, unit: "stk", location: "Tørrvareskap", expirationDate: null },
        { id: "test-3", name: "Ost", quantity: 200, unit: "g", location: "Kjøleskap", expirationDate: null }
      ]
    })
  });
  const text = await response.text();
  return new NextResponse(text, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("content-type") || "application/json", "Cache-Control": "no-store" }
  });
}
