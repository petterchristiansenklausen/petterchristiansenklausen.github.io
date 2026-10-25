# Min Mat AI – sikkerhetstrinn 1 (utkast, ikke publisert)

## Hensikt
Stabilisere kostnadskontroll før brukerbaserte AI-kreditter innføres. Endringene gjelder kun AI-endepunktene; de endrer ikke SwiftData/CloudKit, Pro-rettigheter eller App Store-kjøp.

## Hva endres?
- `/api/chef`, `/api/inventory-photo` og `/api/recipe-method` går fra per-instans-tellere til delte PostgreSQL-tellere.
- Alle tre deler en **samlet månedlig AI-tekstkvote** (standard 250 forespørsler/måned) som forhindrer ubegrenset antall forespørsler ved nye serverinstanser, nye installasjons-IDer eller nye IP-adresser.
- Daglige grenser per hash av IP: kokk 20, matvarebilde 10, fremgangsmåte 20. Dette er midlertidige misbruksgrenser, ikke brukerbaserte rettigheter.
- Manglende databaseoppsett eller databasefeil gir 503 uten AI-kall (fail closed).
- Samme eksisterende tabell `public.recipe_image_quota` som generering av oppskriftsbilder brukes; ingen skjemamigrering er planlagt.

## Må bekreftes før produksjonsutrulling
1. Bekreft at `MIN_MAT_IMAGE_LIMITS_DATABASE_URL` peker til riktig, fungerende database og at `public.recipe_image_quota(bucket,used,expires_at)` finnes. Neon-prosjektet var ikke synlig i tilgjengelig Neon-tilkobling.
2. Test mot **separat testdatabase** eller preview med tilsvarende schema – ikke bruk produksjonsdatabasen til kvotetester.
3. Bekreft at App Store/TestFlight-klienten fortsatt får samme API-svarformat og at 429/503 vises forståelig.
4. Kontroller aktive **Vercel AI Gateway-budsjetter** og faktiske kostnader. En antallsgrense er ikke en pengebasert hard grense; forskjellige kall kan ha svært forskjellig pris.
5. Ta stilling til terskler før publisering. Env-variabler (valgfritt): `MIN_MAT_TEXT_AI_MONTHLY_LIMIT`, `MIN_MAT_CHEF_DAILY_PER_VISITOR`, `MIN_MAT_INVENTORY_DAILY_PER_VISITOR`, `MIN_MAT_METHOD_DAILY_PER_VISITOR`. Alle har sikre standarder.

## Viktig begrensning
`MIN_MAT_CLIENT_TOKEN` i en installert iPhone-app er ikke individuell brukerautentisering; header `x-minmat-installation` kan forfalskes. Denne løsningen begrenser globale AI-kostnader, men er **ikke** et betalings- eller kredittsystem. Det krever Apple-kjøpsverifikasjon, ekte konto-/identitetsbinding, serverstyrt saldo og atomisk bokføring.

## Sikker utrulling
Opprett PR og gjennomgå/test. Ikke merge til `main` før riktig database og budsjetter er bekreftet; Vercel bygger produksjon fra `main`. Ingen endringer gjøres i den stabile iOS build 86.
