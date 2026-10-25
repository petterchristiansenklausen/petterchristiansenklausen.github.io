# Mine Apper Admin — Min Mat AI-forbruk

Dette er en forberedende endring på en egen GitHub-gren. Den er **ikke publisert**
i Min Mat eller Mine Apper Admin.

## Hensikt
Måle faktiske forespørsler gjennom Vercel AI Gateway for AI-kokk,
vareskanning, fremgangsmåter og oppskriftsbilder, uavhengig av Vercels
betalte Custom Reporting API.

## Personvern
Lagres: dato/tid, forhåndsdefinert funksjonsnavn, modell, Gateway HTTP-status,
input/output-tokens når kjent, og *faktisk oppgitt* USD-kostnad når kjent.

Lagres ikke: oppskrifter, matlager, bildeinnhold, prompt, IP-adresse,
installasjons-ID, API-nøkler eller svartekst.

Manglende kostnader forblir `NULL` og **må ikke vises som $0**.

## Aktivering
1. Velg en dedikert PostgreSQL-database for rapportering; bruk gjerne en
   separat database fra produksjonsdata.
2. Utfør den ikke-destruktive tabellmigrasjonen `sql/001_ai_usage.sql`.
3. Opprett to separate roller: en med `INSERT` for Min Mat og en med
   `SELECT` for Mine Apper Admin. Ikke bruk adminrollen som appens skriverolle.
4. Sett `MIN_MAT_TELEMETRY_DATABASE_URL` i Min Mats Vercel-servermiljø
   til skrivertilgangen. Hemmeligheten skal aldri i kildekode eller klient.
5. Sett `MIN_MAT_REPORT_DATABASE_URL` i Admin-servermiljøet til
   lesetilgangen, etter at Admin-kildens tabellnavn er kontrollert.
6. Test én forespørsel per funksjon; sammenlign med AI Gateway Logs.
   Kostnadsdekning vil variere dersom Gateway ikke returnerer kostnad inline.

Skriving skjer etter at API-svaret er klargjort via Next.js `after()`.
Dersom database eller env mangler, oppfører Min Mat seg som før.
Ingen nye abonnementer, løpende kjøp eller tillatelsesendringer gjøres her.
