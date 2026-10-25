// Read-only AI Gateway credit lookup. Never return the OIDC token to clients.
const endpoint = "https://ai-gateway.vercel.sh/v1/credits";

// AI Gateway can return decimal-string amounts. Preserve real zeroes; reject unexpected input.
function validCredits(value) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

export async function readGatewayCredits(request) {
  // Vercel OIDC at runtime arrives through a *request header*, not process.env.
  // The environment variable is only a fallback for build or local development.
  // On Vercel, x-vercel-oidc-token is injected into the function's Request.
  const oidc = request?.headers?.get("x-vercel-oidc-token") ||
    process.env.VERCEL_OIDC_TOKEN;

  if (!oidc) return {
    status: "unavailable",
    reason: "oidc_unavailable",
    note: "Vercel OIDC mangler i forespørselen. Kontroller Secure Backend Access/OIDC i prosjektet."
  };

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { authorization: `Bearer ${oidc}`, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return {
      status: "unavailable",
      reason: "gateway_http_error",
      httpStatus: response.status,
      note: "AI Gateway kunne ikke returnere kredittsaldo nå."
    };

    const payload = await response.json();
    const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
    const balance = validCredits(data?.balance);
    const totalUsed = validCredits(data?.total_used);
    if (balance === null || totalUsed === null) return {
      status: "unavailable", reason: "unsupported_gateway_response",
      note: "AI Gateway svarte, men saldoformatet var ikke som forventet."
    };

    return {
      status: "available",
      scope: "vercel_team",
      balance,
      totalUsed,
      unit: "USD credits",
      source: "Vercel AI Gateway /v1/credits"
    };
  } catch {
    return {
      status: "unavailable", reason: "gateway_fetch_failed",
      note: "Tjenesten svarte ikke. Prøv å oppdatere rapporten."
    };
  }
}
