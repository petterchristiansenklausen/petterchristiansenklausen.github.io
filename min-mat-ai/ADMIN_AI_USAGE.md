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

## Status 25. oktober 2026 (faktisk oppsett)

- Neon-prosjekt: `appstore-live-dashboard` (`purple-river-08807324`).
- Opprettet en **egen database**, `mine_apper_ai_reporting`, slik at dette
  ikke blandes med `appstore_live` eller `min_mat_image_limits`.
- Opprettet `public.min_mat_ai_usage` med de syv aggregeringsfeltene
  `recorded_at`, `feature`, `model`, `gateway_status`,
  `cost_usd`, `input_tokens` og `output_tokens`, pluss løpenummer.
- Opprettet begrensede roller `mine_ai_writer_restricted` (INSERT)
  og `mine_ai_reader_restricted` (SELECT). Bekreftet at de ikke har
  tilgang til motsatt operasjon eller `neon_superuser`.
- **Begge rollene har NOLOGIN.** Ingen databasepassord er etablert for dem,
  og ingen nye Vercel-miljøvariabler er satt.
- Neon API ga tidligere nyopprettede roller `neon_superuser` som standard;
  de overflødige API-rollene for leser og skriver er slettet.
  Eieren `mine_ai_telemetry_owner` for den nye databasen ligger fortsatt
  kun i Neon og skal **ikke** brukes som appens databasekonto.
- Denne grenen bygger som Vercel Preview; den er ikke produksjon.
- Loggtabellen er tom inntil en trygg forbindelse er aktivert og testet.

### Gjenstående sikker aktivering

1. Aktiver LOGIN for de to begrensede rollene i Neon, med unike, sterke
   passord håndtert **direkte i sikkerhetsmiljøet**, ikke i GitHub, chat eller logger.
2. Legg skrivekontoens forbindelse inn som
   `MIN_MAT_TELEMETRY_DATABASE_URL` i Min Mat på Vercel.
   Begynn på Preview-miljøet.
3. Legg lesekontoens forbindelse inn som
   `MIN_MAT_REPORT_DATABASE_URL` i Admin på Vercel.
4. Bekreft Admin-serverkildens tabellnavn og korrekt datavisning.
5. Test AI-funksjonene mot preview, og sammenlign kostnadsverdiene
   med de offisielle AI Gateway-loggene. Ikke tolk NULL som nullforbruk.
6. Først deretter vurder å publisere kildeendringen.

**Obs:** Ingen automatisk krysskobling av databasepassord ble gjort.
En sikkerhetskontroll sperret overføring av slike opplysninger mellom
de to tjenestene. Ingen hemmeligheter ble eksponert.

## Videreført i oktober 2026

- Min Mat-koden kan nå slå opp registrert **faktisk USD-kostnad** med
  `GET /v1/generation?id=gen_...` når Gateway svarer med en gyldig
  genererings-ID. Kallene skjer kun server-side etter at AI-svaret er laget.
  Hvis ID eller kostnad mangler, står kostnaden som ukjent (`NULL`).
- Opprettet aggregert skrivebeskyttet dagsvisning
  `public.min_mat_ai_daily` i rapportdatabasen.
  Den viser dag, funksjon, modell, forespørsler, feil, ukjent kostnad,
  sum kjent kostnad, tokens og siste registrering.
- Leserrollen kan **kun lese**, skriverrollen kan **kun legge til målinger**.
  Begge er uten innlogging, rolleadministrasjon, database-/skjemaoppretting
  og uten Neon-superbrukermedlemskap.
- Oppsettsfilen for dagsvisningen er `sql/002_daily_admin_report.sql`.
- Den siste Vercel Preview-bygningen skal være `READY` før sammenslåing.
- Min Mat i produksjon og den eksisterende Admin-siden er ikke endret.
- Databasekoblingen og innlogging for begrensede roller gjenstår:
  sensitivt passordmateriale skal settes direkte i Neon/Vercel,
  ikke transporteres mellom verktøy gjennom chat.

### Sikkerhetskontroll

Bruk dette som mål for rolleprivilegier (alle ikke-listede adminprivilegier `false`):

| Rolle | SELECT råtabell | INSERT råtabell | SELECT dagsvisning |
| --- | --- | --- | --- |
| mine_ai_reader_restricted | ja | nei | ja |
| mine_ai_writer_restricted | nei | ja | nei |

Når direkte pålogging konfigureres, behold de samme rettighetene.
