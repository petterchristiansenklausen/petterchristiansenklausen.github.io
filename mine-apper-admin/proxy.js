import { NextResponse } from "next/server";
import { auth, authConfigured, isAdminSession } from "./auth";

// No administrative API is permitted based solely on the outer Vercel login.
// The check here is repeated by individual route handlers (defense in depth).
export const proxy = auth((request) => {
  if (!authConfigured()) {
    return NextResponse.json(
      { error: "Administratortilgang er ikke konfigurert" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
  if (!isAdminSession(request.auth)) {
    return NextResponse.json(
      { error: "Ikke autorisert" },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }
  return NextResponse.next();
});
export const config = { matcher: ["/api/admin/:path*"] };
