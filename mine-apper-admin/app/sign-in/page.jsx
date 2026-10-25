import { auth, authConfigured, isAdminSession, signIn } from "../../auth";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function SignInPage() {
  if (authConfigured()) {
    const session = await auth();
    if (isAdminSession(session)) redirect("/");
  }
  async function login() { "use server"; await signIn("github", { redirectTo: "/" }); }
  return <main className="setup">
    <span className="eyebrow">Mine Apper Admin</span><h1>Administratortilgang</h1>
    <p>Denne siden krever både Vercel-tilgang og en personlig GitHub-innlogging godkjent av administrator.</p>
    {authConfigured() ?
      <form action={login}><button type="submit">Logg inn med GitHub</button></form> :
      <div className="notice"><strong>Innlogging er ikke konfigurert</strong><p>Administrator-API-ene er sperret til sikker OAuth-konfigurasjon er klar.</p></div>}
    <p className="subtle">Ingen offentlige brukerkontoer eller gjestetilganger er tilgjengelige.</p>
  </main>;
}
