import { auth, authConfigured, isAdminSession, signOut } from "../auth";
import { redirect } from "next/navigation";
import AIUsagePanel from "./components/ai-usage-panel";

export const dynamic = "force-dynamic";

const appNames = [
  "Mine Katter", "Mine Hunder", "Mine Akvarier", "Min Mat",
  "Mine Ting", "Mine Biler", "Mine Eiendommer", "Mine Fargeark", "Min Kriseplan"
];
const modules = [
  ["AI & Kostnader","Direkte kredittstatus fra AI Gateway, med tydelig merket teamomfang","Lesestatus"],
  ["AI-kreditter","Kjøp, saldo og transaksjoner","Deaktivert"],
  ["Økonomi","App Store Connect, Pro-salg og rapporter","Ikke tilkoblet"],
  ["Drift & Sikkerhet","Hendelser, tilgang og revisjonslogg","Under oppsett"],
  ["Support","Henvendelser fra appene","Ikke tilkoblet"],
  ["Innstillinger","Integrasjoner og rettigheter","Skrivebeskyttet"]
];
export default async function Dashboard() {
  if (!authConfigured()) {
    return <main className="setup"><span className="eyebrow">Mine Apper Admin · sikkerhetsoppsett</span><h1>Administrasjonen er sperret</h1><p>Vercel-beskyttelse er aktiv, men egen administratorinnlogging er ikke konfigurert ennå. Ingen administrative API-er eller kundedata er åpnet.</p><div className="notice"><strong>Neste trinn</strong><p>Konfigurer GitHub OAuth Client ID, Client Secret og den godkjente GitHub-kontoens ID i Vercel. Hemmelige verdier må bare legges inn i Vercel, aldri i nettsiden.</p></div></main>;
  }
  const session = await auth();
  if (!isAdminSession(session)) redirect("/sign-in");
  async function logout() { "use server"; await signOut({ redirectTo: "/sign-in" }); }
  return <div className="shell">
    <aside className="sidebar">
      <div className="identity"><div className="logo">M</div><div><strong>Mine Apper</strong><small>ADMIN · PRIVAT</small></div></div>
      <nav aria-label="Hovedmeny"><a href="#oversikt">Oversikt</a><a href="#apper">Mine apper</a><a href="#moduler">AI & Kostnader</a><a href="#moduler">AI-kreditter</a><a href="#moduler">Økonomi</a><a href="#sikkerhet">Drift & Sikkerhet</a></nav>
      <form action={logout}><button className="secondary" type="submit">Logg ut</button></form>
      <div className="footnote">Beskyttet med Vercel og GitHub OAuth</div>
    </aside>
    <main className="content"><header id="oversikt"><div><span className="eyebrow">Mine-familien / administrasjon</span><h1>Oversikt</h1><p>Samlet kontrollsenter for alle Mine-appene.</p></div><span className="pill">Verifisert administrator</span></header>
      <section className="notice" id="sikkerhet"><strong>Administratortilgang aktiv</strong><p>Innloggingen er kontrollert mot en eksplisitt GitHub-ID. Endringer, betalinger og integrasjoner er fortsatt sperret til tjenestene er klart konfigurert.</p></section>
      <section className="metrics" aria-label="Oversikt">
        <div className="metric"><small>Apper i registeret</small><strong>9</strong><span>Prosjektoversikt</span></div>
        <div className="metric"><small>AI-kreditter</small><strong>Se under</strong><span>Direktetilkobling testes</span></div>
        <div className="metric"><small>Min Mat AI-kostnader</small><strong>—</strong><span>Per app ikke tilkoblet</span></div>
        <div className="metric"><small>Endringsfunksjoner</small><strong>Av</strong><span>Skrivebeskyttet</span></div>
      </section>
      <AIUsagePanel />
      <section id="apper"><div className="sectionheading"><h2>Mine apper</h2><small>9 registrerte</small></div><div className="appgrid">{appNames.map((name) => <div className="appcard" key={name}><span className="diamond">◆</span><strong>{name}</strong><small>Ikke tilkoblet</small></div>)}</div></section>
      <section id="moduler"><div className="sectionheading"><h2>Administrasjon</h2><small>Forberedte moduler</small></div><div className="modulegrid">{modules.map(([title,body,state])=><article className="module" key={title}><h3>{title}</h3><p>{body}</p><span className="tag">{state}</span></article>)}</div></section>
      <footer>Mine Apper Admin · Kun autorisert lesetilgang til AI Gateway-kreditter der tilgjengelig</footer>
    </main>
  </div>;
}
