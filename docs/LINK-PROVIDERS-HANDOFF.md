# Link-Providers Flow — Handoff

Single Account Model + provider linking, per the approved plan
`Single Account Model + Link-Providers Flow` (plan id `efc245f3`).

This document describes **what was changed locally**, **what to run on
the VPS to roll it out**, and **what is intentionally NOT done yet**.

---

## TL;DR — What this delivers

A logged-in user can link Discord / Google / GitHub to the **same**
Grudge ID without accidentally creating a duplicate account, can unlink
providers (except their last one), and can merge another Grudge ID into
theirs by presenting both JWTs.

The unique key `user_providers (provider, provider_uid)` already in
`01-auth-schema.sql` is the database-level guarantee that one provider
account can only ever map to one Grudge ID.

---

## Files changed

### Backend (`F:\GitHub\grudge-studio-backend\`)

| File | Change |
| ---- | ------ |
| `mysql/migrations/02-user-providers-link-flow.sql` | **new** — additive ALTERs (idempotent): `provider_email`, `last_login_at`, `idx_provider_email` |
| `services/grudge-id/src/services/user.js` | **extended** — new helpers `findProviderLink`, `getProvidersDetailed`, `attachProviderToUser`, `unlinkProvider`, `mergeUsers`. Existing functions untouched. |
| `services/grudge-id/src/services/jwt.js` | **extended** — new helpers `signLinkIntent` / `verifyLinkIntent` (5 min, audience `link-intent`). |
| `services/grudge-id/src/routes/links.js` | **new** — `/auth/links/*` (plural) endpoints |
| `services/grudge-id/src/index.js` | **2 line edit** — `require` + `app.use('/auth/links', linksRoute)` |
| `scripts/migrate.sh` | **new** — generic migration runner with `_migrations` bookkeeping table (also fixes a latent reference in `deploy-migrate.sh`) |
| `scripts/deploy-link-providers.sh` | **new** — focused deploy: migrations → rebuild grudge-id only → health check |

### Frontend (`C:\Users\nugye\Documents\GitHub\grudge-platform\`)

| File | Change |
| ---- | ------ |
| `api/auth/links/index.js` | **new** — Vercel proxy `GET /api/auth/links` |
| `api/auth/links/start.js` | **new** — `POST /api/auth/links/start` |
| `api/auth/links/merge.js` | **new** — `POST /api/auth/links/merge` |
| `api/auth/links/[provider]/[providerUid].js` | **new** — `DELETE /api/auth/links/:provider/:providerUid` |
| `src/lib/api.ts` | **extended** — `export const links = { list, start, unlink, merge }` + types |
| `src/components/LinkedAccountsCard.tsx` | **new** — UI card for the link/unlink/merge flow |
| `src/pages/ProfilePage.tsx` | **edited** — drops the placeholder `LINKED APPS` row, mounts `<LinkedAccountsCard />` |

### What was NOT changed (intentionally)

- `services/grudge-id/src/routes/link.js` (the singular `/auth/link`) is
  untouched — backward compat for any caller still using it.
- `services/grudge-id/src/services/user.js::findOrCreateByProvider` is
  untouched — its existing find-by-email implicit attach already covers
  the "user logs in with a second provider exposing the same email"
  case, and we don't want to perturb behavior that is already correct.
- The Discord / Google / GitHub login routes (`routes/discord.js` etc.)
  are untouched. Linking goes through a **dedicated** callback path
  `/auth/links/callback/:provider` so that link-intent JWTs (audience
  `link-intent`) can never be confused with normal login state and we
  don't have to redeploy those routes.
- No table was dropped, renamed, or had a column type changed.

---

## How to roll it out (VPS — 1 command)

```sh
ssh vps
cd /opt/grudge-studio-backend

# Optional dry-run first to see what migrate.sh would do.
DRY_RUN=1 bash scripts/deploy-link-providers.sh

# Real deploy: applies migration 02, rebuilds & restarts grudge-id only.
bash scripts/deploy-link-providers.sh
```

The deploy script:

1. `git fetch && git reset --hard origin/main` (only if `.git` exists)
2. Runs every un-applied SQL file in `mysql/migrations/` exactly once
3. Rebuilds and restarts **only** the `grudge-id` container
4. Curls `http://localhost:3001/health` until it's green

If step 3 fails, the previous `grudge-id` container is left in place
(Compose's atomic replace) and step 4 will exit non-zero. No other
service is touched.

For the proxy / UI side, push the `grudge-platform` change to your
deploy branch — Vercel will build automatically. The new endpoints are
under `/api/auth/links/*` and require an `Authorization: Bearer …`
header which the existing `localProxyFetch` already provides.

### Required env on the backend

The OAuth link flows reuse the same env vars the login routes already
need — there's nothing new:

```
DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET
GOOGLE_CLIENT_ID  / GOOGLE_CLIENT_SECRET
GITHUB_CLIENT_ID  / GITHUB_CLIENT_SECRET
JWT_SECRET        (same secret used for access tokens)
```

You'll also want to **register the new callback URLs** in each provider's
developer console:

- Discord: `https://id.grudge-studio.com/auth/links/callback/discord`
- Google:  `https://id.grudge-studio.com/auth/links/callback/google`
- GitHub:  `https://id.grudge-studio.com/auth/links/callback/github`

These are NEW URLs (login still uses `/auth/<provider>/callback`). Until
you register them, any user who hits LINK in the UI will get an OAuth
"redirect_uri mismatch" error from the provider — but logins are
unaffected.

---

## Smoke tests

After deploy, log in as a real user on grudgeplatform.io and:

1. Open `/profile` — confirm the new **LINKED ACCOUNTS** card lists
   every provider (Discord, Google, GitHub, Wallet, Phone, Puter, Email).
2. Pick a provider you have NOT yet linked → click LINK → consent on
   the provider page → confirm you land back on `/profile?status=linked`
   and the row now shows "Linked as <email>".
3. Try to UNLINK your only auth provider → button disabled, tooltip
   explains why.
4. From a second account, click LINK on a provider that's already
   linked to your primary → confirm you land on `/profile?status=conflict&conflictUserId=…`.
5. (Optional) Test the merge endpoint via `curl -X POST /api/auth/links/merge -d '{"otherToken":"<jwt>"}'`.

API smoke (no UI):

```sh
TOK=<your access token>
curl -H "Authorization: Bearer $TOK" https://id.grudge-studio.com/auth/links | jq
curl -X POST -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
     -d '{"provider":"discord"}' https://id.grudge-studio.com/auth/links/start | jq
```

---

## Open questions still owned by you

These are the three the plan explicitly flagged. Item 2 was answered
during this implementation — the others remain.

### 1. Deploy mechanism long-term

**Plan question:** "Deploy via the `vps-deploy.py` python pattern, or
set up proper git-based deploy from a `grudge-studio-backend` repo
first?"

**Status:** The repo now exists at
`https://github.com/Grudge-Warlords/grudge-studio-backend` and the VPS
already has a `.git` checkout at `/opt/grudge-studio-backend`. The new
`scripts/deploy-link-providers.sh` does `git fetch + reset --hard
origin/main` if the repo is present. So git-based deploy is **already
the default path** for this slice.

**Decision needed:** do you want me to also retire `vps-deploy.py`
(the python `docker cp` script) so there's only one path? It still
works but creates drift opportunity.

### 2. id.grudge-studio.com frontend stack ✅ **answered**

**Plan question:** "React or server-side templates?"

**Found:** It's a **static HTML page** at
`services/grudge-id/public/auth.html` served directly by Express. The
React app on `grudgeplatform.io` is a separate property. We chose to
put the link-providers UI on `grudgeplatform.io/profile` (which is the
React app the user already lands on) and leave the `id.grudge-studio.com`
static page for sign-in only. If you also want a copy of the UI on
`id.grudge-studio.com/profile/links`, that's a follow-up — the same
backend endpoints back it.

### 3. Re-verify password before linking?

**Plan question:** "For phone/email link-back: should we re-verify the
user's password before linking a new provider, or trust the active
session JWT? (Industry standard: re-verify if the session is older
than 15 min.)"

**Current behavior:** We trust the session JWT. The link-intent JWT
itself expires in 5 minutes, so the attack window for a stolen access
token is bounded, but we do NOT prompt for password.

**Decision needed:** if you want the industry-standard 15-minute
re-verify, the easiest implementation is:
- Store `iat` on the access token (already there from `jsonwebtoken`).
- In `POST /auth/links/start`, reject when `Date.now() - iat*1000 > 15*60*1000` and respond `403 reauth_required`.
- The UI catches that and shows a "Confirm your password" modal that
  hits a new `POST /auth/reauth` endpoint to mint a fresh access token.

I left this out of the first cut to keep the change additive.

---

## Risk assessment

**Disruption surface:** zero existing endpoint paths or DB columns were
touched. The migration is idempotent and additive. The deploy script
restarts `grudge-id` only, leaving every other service running.

**Rollback:** `docker compose up -d --no-deps grudge-id` against the
previous image tag. The migration is forward-only but the new columns
are nullable and unread by old code, so leaving them in place is fine.

**Worst case:** the LINK button on `/profile` errors. Existing logins
keep working because none of their code paths changed.
