# Mine Apper Admin – auth phase 1

This is a separate Next.js administrative application. Vercel Deployment Protection must remain enabled for all deployment URLs. That external gate alone is NOT application-level user authorization.

## Authentication

Uses Auth.js/NextAuth v5 and GitHub OAuth. Each login is checked against a single, stable GitHub numeric user ID, not the display name or email address. This ID is checked again on every protected API call; only a verified encrypted server session authorizes requests. No database or financial integration is active. Login and API actions fail closed when any essential variable is absent.

Required Vercel environment variables:
- AUTH_SECRET – cryptographically random high-entropy secret, stored as Sensitive/Encrypted.
- AUTH_GITHUB_ID – OAuth application's client ID.
- AUTH_GITHUB_SECRET – OAuth client secret, stored as Sensitive/Encrypted.
- ADMIN_GITHUB_USER_ID – exact numeric GitHub ID of the sole authorized administrator.

Create the GitHub OAuth App at https://github.com/settings/developers (OAuth Apps, New OAuth App).
For the canonical domain configure callback:
https://mine-apper-admin-uap-watch.vercel.app/api/auth/callback/github
and homepage:
https://mine-apper-admin-uap-watch.vercel.app

Do not copy the client secret into messages or commit it to GitHub.
Apply secrets in Vercel directly; do not expose via NEXT_PUBLIC_ variables.
Only enable data integrations after login has been tested in signed-out and non-owner sessions, including direct /api/admin/status requests.

## Scope and limitations

There is no database or append-only audit log yet. Anonymous access is already blocked by Vercel Authentication; in-app admin access is *additionally* blocked until GitHub OAuth is configured and verified. API routes must enforce auth independently of Proxy checks. The status endpoint returns only non-sensitive static integration state.

GitHub OAuth is an additional login on top of Vercel. An existing Vercel session does not suffice to authorize administrative APIs.

Do not configure admin.mineapper.no or route real customer, payment, or quota data here until readiness tests succeed.

The Sites UI is still a separate draft and has not been imported exactly. Changes in this directory must not modify mineapper.no or min-mat-ai.
