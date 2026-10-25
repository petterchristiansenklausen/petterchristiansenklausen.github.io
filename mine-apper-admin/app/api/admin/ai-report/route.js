import { auth, authConfigured, isAdminSession } from "../../../../auth";
import { readGatewayCredits } from "../../../../lib/gateway-credits";
import { readMinMatUsage } from "../../../../lib/min-mat-usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store, max-age=0", "X-Robots-Tag": "noindex" };

export async function GET(request) {
  if (!authConfigured()) {
    return Response.json({ error: "Administrasjon ikke konfigurert" }, { status: 503, headers: noStore });
  }
  const session = await auth();
  if (!isAdminSession(session)) {
    return Response.json({ error: "Ikke autorisert" }, { status: 403, headers: noStore });
  }
  const [credits, minMat] = await Promise.all([readGatewayCredits(request), readMinMatUsage()]);
  return Response.json({
    schemaVersion: 1,
    kind: "mine-apper-admin-ai-snapshot",
    generatedAt: new Date().toISOString(),
    team: { slug: "uap-watch", displayName: "Mine Apper" },
    minMat,
    aiGateway: {
      credits,
      scopeDescription: "Gjelder Vercel-teamet Mine Apper samlet, ikke bare Min Mat.",
      detailedPerProjectCosts: {
        status: "unavailable_on_current_plan",
        reason: "Vercels detaljerte rapporterings-API krever betalt plan. Ingen planendring er foretatt."
      }
    },
    connections: {
      appStoreConnect: "not_connected",
      aiCreditPurchases: "not_connected",
      customerRecords: "not_connected"
    },
    security: {
      personalAdminAccess: "required",
      exportContainsSecrets: false,
      readOnly: true
    }
  }, { headers: noStore });
}
