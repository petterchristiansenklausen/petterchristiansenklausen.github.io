import { auth, authConfigured, isAdminSession } from "../../../../auth";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!authConfigured()) return Response.json({ error: "Konfigurasjon mangler" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const session = await auth();
  if (!isAdminSession(session)) return Response.json({ error: "Ikke autorisert" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  return Response.json({
    status: "admin_authorized", integrations: "not_connected", readOnly: true
  }, { headers: { "Cache-Control": "no-store" } });
}
