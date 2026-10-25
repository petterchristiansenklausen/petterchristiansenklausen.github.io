"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

const FEATURES = [
  ["chef", "AI-kokk"], ["inventory-photo", "Vareskanning"],
  ["recipe-method", "Fremgangsmåte"], ["recipe-image", "Oppskriftsbilder"]
];
const formatNumber = (n) => new Intl.NumberFormat("nb-NO").format(n);
const formatUSD = (n) => typeof n === "number" && Number.isFinite(n)
  ? "$" + new Intl.NumberFormat("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(n)
  : "—";
const formatCredit = (n) => typeof n === "number" && Number.isFinite(n)
  ? new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 5 }).format(n) : "—";

function summarize(rows) {
  return rows.reduce((a, r) => ({
    requests: a.requests + r.requests,
    errors: a.errors + r.errors,
    unknown: a.unknown + r.missingCost,
    cost: a.cost + r.knownCostUSD,
    input: a.input + r.inputTokens,
    output: a.output + r.outputTokens
  }), {requests:0,errors:0,unknown:0,cost:0,input:0,output:0});
}
const todayUTC = () => new Date().toISOString().slice(0, 10);
const dateCutoff = (days) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString().slice(0,10);
};
function advisory(title, amount, threshold) {
  if (threshold === null || !Number.isFinite(threshold) || threshold <= 0) return null;
  const ratio = amount / threshold;
  if (ratio >= 1) return title + ": registrert kostnad har passert den veiledende varselgrensen på " + formatUSD(threshold) + ".";
  if (ratio >= .75) return title + ": registrert kostnad har nådd " + Math.floor(ratio * 100) + " % av veiledende varselgrense.";
  return null;
}

export default function AIUsagePanel() {
  const [report, setReport] = useState(null);
  const [period, setPeriod] = useState(30);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setFeedback("");
    try {
      const res = await fetch("/api/admin/ai-report", { cache:"no-store", credentials:"same-origin" });
      if (!res.ok) throw new Error(res.status === 403 ? "Du har ikke administratorrettigheter." : "Kunne ikke hente analyserapport.");
      const obj = await res.json();
      if (obj.kind !== "mine-apper-admin-ai-snapshot") throw new Error("Uventet rapportformat.");
      setReport(obj);
    } catch (err) {
      setReport(null);
      setFeedback(err instanceof Error ? err.message : "Kunne ikke hente rapporten.");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const metrics = report?.minMat;
  const connected = metrics?.status === "available";
  const rows = useMemo(() => connected
    ? (metrics.daily || []).filter((r) => r.day >= dateCutoff(period)) : [], [metrics, connected, period]);
  const totals = useMemo(() => summarize(rows), [rows]);
  const grouped = useMemo(() => FEATURES.map(([id,name]) => ({
    feature:id, name, ...summarize(rows.filter((r) => r.feature === id))
  })), [rows]);
  const days = useMemo(() => {
    const list = new Map();
    for (const row of rows) list.set(row.day, (list.get(row.day) || 0) + row.knownCostUSD);
    return Array.from(list, ([day, cost]) => ({ day, cost })).sort((a,b)=>a.day.localeCompare(b.day));
  }, [rows]);
  const highestDay = Math.max(0, ...days.map((r) => r.cost));
  const todayTotals = summarize(rows.filter((r) => r.day === todayUTC()));
  const monthStart = todayUTC().slice(0,7) + "-01";
  const monthTotals = summarize((metrics?.daily || []).filter((r) => r.day >= monthStart));
  const thresholds = metrics?.thresholds || {};
  const warnings = connected ? [
    advisory("I dag", todayTotals.cost, thresholds.dailyUSD),
    advisory("Denne måneden", monthTotals.cost, thresholds.monthlyUSD)
  ].filter(Boolean) : [];
  const credits = report?.aiGateway?.credits;
  const creditsAvailable = credits?.status === "available";

  const exportData = useCallback(() => report ? {
    ...report,
    analysisSelection: {
      periodDays: period, minMat: connected ? {
        requests: totals.requests, errors: totals.errors,
        knownCostUSD: Number(totals.cost.toFixed(8)),
        missingCostRequests: totals.unknown,
        byFeature: grouped,
        byDay: days
      } : {status:metrics?.status || "not_connected"}
    }
  } : null, [report, period, connected, totals, grouped, days, metrics]);

  async function copyReport() {
    const data = exportData(); if (!data) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setFeedback("Analyserapport kopiert. Lim den inn i ChatGPT.");
    } catch {
      setFeedback("Kunne ikke kopiere automatisk. Bruk Last ned JSON i stedet.");
    }
  }
  function downloadReport() {
    const data = exportData(); if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url;
    link.download = "mine-apper-ai-analyse-" + report.generatedAt.slice(0,10) + ".json";
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
    setFeedback("JSON-rapporten er lastet ned og kan legges ved i ChatGPT.");
  }

  return <section id="ai-kostnader" className="ai-panel" aria-labelledby="ai-heading">
    <div className="sectionheading"><h2 id="ai-heading">AI & Kostnader</h2><span className="source-note">Skrivebeskyttet · USD</span></div>
    <p className="ai-intro">AI Gateway-kredittene gjelder <strong>hele Vercel-teamet</strong>. Min Mat-tallene kommer fra et separat måleregister og er uavhengige av kredittsaldoen.</p>
    <div className="metrics">
      <article className="metric"><small>Kreditter igjen · Vercel-teamet</small><strong>{loading?"…":creditsAvailable?formatCredit(credits.balance):"—"}</strong><span>{creditsAvailable?"USD-kreditter":"Ikke tilgjengelig"}</span></article>
      <article className="metric"><small>Brukt totalt · Vercel-teamet</small><strong>{loading?"…":creditsAvailable?formatCredit(credits.totalUsed):"—"}</strong><span>USD-kreditter hittil</span></article>
      <article className="metric"><small>Min Mat · målt kostnad</small><strong>{connected?formatUSD(totals.cost):"—"}</strong><span>{connected?period+" dager · "+totals.unknown+" forespørsler uten kjent kostnad":"Måling ikke tilkoblet"}</span></article>
      <article className="metric"><small>Siste rapport</small><strong className="date-value">{report?new Date(report.generatedAt).toLocaleString("nb-NO"):"—"}</strong><span>Rapporttidspunkt</span></article>
    </div>

    {report && !creditsAvailable && <p className="availability-note">Kredittsaldo er utilgjengelig: {credits?.note || "Ingen kildeverdi."}</p>}
    <div className="report-actions">
      <button type="button" onClick={()=>void refresh()} disabled={loading}>{loading?"Henter…":"Oppdater tall"}</button>
      <button type="button" className="subtle-button" onClick={()=>void copyReport()} disabled={!report||loading}>Kopier analyserapport</button>
      <button type="button" className="subtle-button" onClick={downloadReport} disabled={!report||loading}>Last ned JSON</button>
    </div>
    {feedback && <p className="action-feedback" role="status">{feedback}</p>}

    <div className="sectionheading analytics-head"><h2>Min Mat – AI-forbruk</h2>
      <div className="period-controls" aria-label="Periode">
        {[7,30,90].map((n)=><button type="button" key={n} className={period===n?"active":""} onClick={()=>setPeriod(n)} aria-pressed={period===n}>{n} dager</button>)}
      </div>
    </div>
    {!connected && <p className="availability-note">{loading?"Henter Min Mat-målinger…":metrics?.note || "Måleregisteret er ikke koblet til ennå. Ingen kostnadstall er antatt."}</p>}
    {connected && <>
      <div className="metrics">
        <article className="metric"><small>AI-forespørsler</small><strong>{formatNumber(totals.requests)}</strong><span>{period} dager, siden måling ble aktivert</span></article>
        <article className="metric"><small>Bekreftet kostnad</small><strong>{formatUSD(totals.cost)}</strong><span>Kun kjente Gateway-kostnader</span></article>
        <article className="metric"><small>Kostnad ikke avklart</small><strong>{formatNumber(totals.unknown)}</strong><span>Forespørsler, ikke 0 dollar</span></article>
        <article className="metric"><small>Feil fra Gateway</small><strong>{formatNumber(totals.errors)}</strong><span>HTTP-feil blant registrerte forsøk</span></article>
      </div>
      <div className="sectionheading analytics-subhead"><h3>Forbruk per AI-funksjon</h3><small>Bekreftet beløp i USD</small></div>
      <div className="table-scroller"><table className="usage-table"><thead><tr><th>Funksjon</th><th>Forespørsler</th><th>Kostnad</th><th>Ukjent kostnad</th><th>Feil</th></tr></thead><tbody>
        {grouped.map((r)=><tr key={r.feature}><th scope="row">{r.name}</th><td>{formatNumber(r.requests)}</td><td>{formatUSD(r.cost)}</td><td>{formatNumber(r.unknown)}</td><td>{formatNumber(r.errors)}</td></tr>)}
      </tbody></table></div>
      <div className="sectionheading analytics-subhead"><h3>Daglig kostnad</h3><small>Kun dager med registrerte forespørsler</small></div>
      {days.length===0 ? <p className="availability-note">Ingen registrerte forespørsler i perioden.</p> :
      <div className="daily-bars" role="img" aria-label="Registrert daglig AI-kostnad i amerikanske dollar">
        {days.slice(-30).map((d)=><div className="bar-line" key={d.day}><span>{d.day.slice(5)}</span><div className="bar-track"><div className="bar-fill" style={{width:(highestDay>0?100*d.cost/highestDay:0)+"%"}}/></div><span>{formatUSD(d.cost)}</span></div>)}
      </div>}
      {warnings.map((s)=><p className="alert-note" key={s} role="status">{s}</p>)}
      {!thresholds.dailyUSD && !thresholds.monthlyUSD && <p className="report-help">Varsler er klargjort, men beløpsgrensene er ikke satt. Når grenser er konfigurert, vises varsel ved 75 % og 100 %. Dette er informasjon i panelet, ikke en hard budsjettgrense.</p>}
      <p className="report-help">Inngående tokens: {formatNumber(totals.input)} · utgående tokens: {formatNumber(totals.output)}. Målingen startet først da telemetrien ble aktivert. Uavklarte kostnader er ikke medregnet i summen.</p>
    </>}
    <p className="report-help">Du kan sende dataene direkte til meg ved å kopiere rapporten eller legge ved JSON-filen i ChatGPT. For eldre forespørsler kan du eksportere CSV/JSON fra <a href="https://vercel.com/uap-watch/min-mat-ai/ai-gateway/logs" target="_blank" rel="noopener noreferrer">Vercel AI Gateway Logs</a>. Fjern eventuelt sensitivt innhold før deling.</p>
  </section>;
}
