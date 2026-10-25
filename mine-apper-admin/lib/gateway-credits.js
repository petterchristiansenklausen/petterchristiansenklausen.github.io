// Read-only AI Gateway Credits lookup. Uses Vercel deployment OIDC, not a browser key.
const endpoint = "https://ai-gateway.vercel.sh/v1/credits";

function nonnegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export async function readGatewayCredits() {
  const oidc = process.env.VERCEL_OIDC_TOKEN;
  if (!oidc) return {
    status: "unavailable", reason: "oidc_unavailable",
    note: "Vercel OIDC er ikke tilgjengelig i dette kjøremiljøet."
  };

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { authorization: `Bearer ${oidc}`, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) {
      return {
        status: "unavailable",
        reason: "gateway_http_error",
        httpStatus: response.status,
        note: "AI Gateway kunne ikke returnere kredittsaldo nå."
      };
    }

    const payload = await response.json();
    const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
    const balance = nonnegativeNumber(data?.balance);
    const totalUsed = nonnegativeNumber(data?.total_used);
    if (balance === null || totalUsed === null) {
      return {
        status: "unavailable", reason: "unsupported_gateway_response",
        note: "Gateway svarte, men saldoformatet var ikke som forventet."
      };
    }
    return {
      status: "available",
      scope: "vercel_team",
      balance,
      totalUsed,
      unit: "AI Gateway credits",
      source: "Vercel AI Gateway /v1/credits"
    };
  } catch {
    return {
      status: "unavailable", reason: "gateway_fetch_failed",
      note: "Tjenesten svarte ikke. Prøv å oppdatere rapporten."
    };
  }
}
