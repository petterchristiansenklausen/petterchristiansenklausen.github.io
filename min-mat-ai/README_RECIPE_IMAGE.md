# Min Mat – bilde-API og serverforslag, 4. november 2026

Denne kilden er en lokal rettelseskandidat. Ingen server er deployet og ingen database er endret.

Appens to bildeinnganger bruker RecipeImageAIService → MinMatBilling.perform → `/api/billing/ai/recipe-image` → `lib/providers/recipe-image/route.ts`. TestFlight bruker den Apple-verifiserte Sandbox-ruten i MinMatAIEndpoint.swift; den går til Preview-grenen `feature/min-mat-recipe-scan-build124`. App Store bruker Production. Kopiering av bare en offentlig route er derfor ikke tilstrekkelig.

## Konfigurasjon som må foreslås/godkjennes separat

| Variabel | Krav |
| --- | --- |
| MIN_MAT_CLIENT_TOKEN | Intern klientport, allerede konfigurert for Preview og Production. Ikke en AI-nøkkel. |
| AI_GATEWAY_API_KEY eller VERCEL_OIDC_TOKEN | Gateway-autentisering. Automatisk Vercel OIDC beholdes; manglende manuell API-nøkkel betyr ikke feil. |
| MIN_MAT_IMAGE_LIMITS_DATABASE_URL | Begrenset databasebruker med SELECT/INSERT/UPDATE på public.recipe_image_quota. Egen isolert Preview-database. |
| MIN_MAT_IMAGE_LIMIT_SALT | Privat tilfeldig streng, minst 24 tegn. Egen Preview-verdi. |
| RECIPE_IMAGE_MONTHLY_LIMIT | Valgfritt 1–1000, standard 100. Ingen økning foreslås. |
| RECIPE_IMAGE_DAILY_PER_VISITOR | Valgfritt 1–10, standard 3. Nå per autentisert konto/miljø i kredittflyten. Ingen økning foreslås. |

Kontrollert Vercel-metadata viste begge nødvendige bildekvotevariabler kun for Production. Dette er en konkret mangel i dagens Preview-oppsett, og den vedlagte koden stopper før Gateway når de mangler. Det er ikke hentet hemmelige verdier eller verifisert historiske miljøsnapshots for det konkrete feiltidspunktet.

`sql/012_image_quota_preview_PROPOSAL.sql` er et ikke-kjørt forslag for isolert Preview. Ikke koble Preview til Production for å løse dette. Behold alle kostnadsgrenser. Kvotetelleren teller forsøk og er separat fra brukerens kredittsaldo. Et avvist dagskvoteforsøk kan også telle mot månedstaket i eksisterende SQL; ingen automatisk tilbakeføring av denne leverandørbeskyttelsen er lagt til.

Modell og format beholdes: `openai/gpt-image-2`, `/v1/images/generations`, n=1, 1024×1024, low, JPEG. Bildet dekodes fullt og reenkodes før brukerkreditter sluttføres. Base64 begrenses til 4 000 000 tegn slik at kredittkonvolutten passer under Vercels 4,5 MB-grense. Sharp er eksplisitt låst til 0.35.5, samme versjon som allerede lå i avhengighetslåsen via Next.

## Foreslått utrulling etter godkjenning

1. Opprett/verifiser isolert Preview-kvotetabell og begrenset runtime-rolle; legg til de to manglende variablene kun på den aktuelle Preview-grenen.
2. Deploy hele Backend/min-mat-ai fra denne kandidaten til Preview, med eksisterende Apple/Sandbox-betaling bevart. Ingen Production-publisering.
3. Kjør `npm ci`, `npm test`, `npm run typecheck`, `npm run build` før deploy. Test én ekte bildegenerering og AI-Kokk på TestFlight først etter egen godkjenning til leverandørforbruk.
4. Kontroller bilde, saldo, reservasjon, forespørsels-ID og feil ved avbrutt nett. Backend må oppdateres før appens rettelser alene kan få bilder til å virke.
5. Production vurderes som et eget senere steg. Ingen pris-, tariffor-, Pro- eller databaseaktivering er del av denne leveransen.

De gamle instruksjonene om OPENAI_API_KEY, Upstash og MINMAT_CLIENT_TOKEN var utdaterte og er erstattet med faktisk kodekontrakt.
