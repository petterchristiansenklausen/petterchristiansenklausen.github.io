"use client";
import { useCallback, useEffect, useState } from "react";

function formatCredit(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 5 }).format(value)
    : "—";
}

export default function AIUsagePanel() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setFeedback("");
    try {
      const res = await fetch("/api/admin/ai-report", { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) throw new Error(res.status === 403 ? "Du har ikke administratorrettigheter." : "Kunne ikke hente analyserapport.");
      const data = await res.json();
      if (data.kind !== "mine-apper-admin-ai-snapshot") throw new Error("Uventet rapportformat.");
      setReport(data);
    } catch (err) {
      setReport(null);
      setFeedback(err instanceof Error ? err.message : "Kunne ikke hente rapporten.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function copyReport() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setFeedback("Rapporten er kopiert. Lim den inn i ChatGPT for analyse.");
    } catch {
      setFeedback("Nettleseren tillot ikke kopiering. Bruk «Last ned JSON» i stedet.");
    }
  }

  function downloadReport() {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "mine-apper-ai-rapport-" + report.generatedAt.slice(0, 10) + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
    setFeedback("Rapporten er lastet ned. Legg JSON-filen ved i ChatGPT for analyse.");
  }

  const credits = report?.aiGateway?.credits;
  const available = credits?.status === "available";
  return <section id="ai-kostnader" className="ai-panel" aria-labelledby="ai-kostnader-heading">
    <div className="sectionheading"><h2 id="ai-kostnader-heading">AI & Kostnader</h2><span className="source-note">Vercel AI Gateway · skrivebeskyttet</span></div>
    <p className="ai-intro">Sikker oversikt over AI-kreditter og status for Min Mat. Kredittsaldoen tilhører <strong>hele Vercel-teamet</strong>, ikke bare Min Mat.</p>
    <div className="metrics" aria-live="polite">
      <article className="metric"><small>Kreditter igjen · teamet</small><strong>{loading ? "…" : available ? formatCredit(credits.balance) : "—"}</strong><span>{loading ? "Henter tall" : available ? "Fra AI Gateway" : "Ikke tilgjengelig"}</span></article>
      <article className="metric"><small>Brukt totalt · teamet</small><strong>{loading ? "…" : available ? formatCredit(credits.totalUsed) : "—"}</strong><span>{available ? "AI Gateway-kreditter hittil" : "Ikke tilgjengelig"}</span></article>
      <article className="metric"><small>Min Mat · kostnader</small><strong>—</strong><span>Per-app-måling ikke tilkoblet</span></article>
      <article className="metric"><small>Rapport hentet</small><strong className="date-value">{report ? new Date(report.generatedAt).toLocaleString("nb-NO") : "—"}</strong><span>{report ? "Tidspunkt for denne rapporten" : "Ingen rapport hentet"}</span></article>
    </div>
    {!loading && !available && <p className="availability-note" role="status">AI Gateway kan ikke levere kredittsaldo automatisk nå. {credits?.note || "Ingen saldo er vist."} Ingen tall er anslått.</p>}
    <div className="report-actions">
      <button onClick={() => void refresh()} disabled={loading}>{loading ? "Henter…" : "Oppdater tall"}</button>
      <button className="subtle-button" onClick={() => void copyReport()} disabled={!report || loading}>Kopier analyserapport</button>
      <button className="subtle-button" onClick={downloadReport} disabled={!report || loading}>Last ned JSON</button>
    </div>
    {feedback && <p className="action-feedback" role="status">{feedback}</p>}
    <p className="report-help">For en grundigere analyse: Trykk «Kopier analyserapport» og lim den inn i ChatGPT, eller last ned JSON og legg ved filen. For kostnader per modell kan du i tillegg eksportere CSV/JSON fra <a href="https://vercel.com/uap-watch/min-mat-ai/ai-gateway/logs" target="_blank" rel="noopener noreferrer">Min Mat AI Gateway Logs</a> og legge ved rapporten i chatten. Kontroller at eventuelle logger ikke inneholder sensitive forespørsler eller kundedata.</p>
  </section>;
}
