# Grudge ID — Account Linking & the Single-Canonical-ID Model

> One human = **one** canonical Grudge ID, forever — with many linked login
> methods, one Puter cloud identity, and one server wallet hanging off it.
> Every signup path converges on that single record; we never mint a second
> account for the same person.

This document is the source of truth for how accounts are created, resolved,
linked, and merged in the `grudge-id` service.

---

## 1. The canonical record

The `users` table (`mysql/init/01-schema.sql` + migrations) is keyed by:

| Field | Meaning | Notes |
|---|---|---|
| `grudge_id` | **The** identity. `VARCHAR(36)`, **UUID v4**. | Immutable. Generated only by `accounts.generateGrudgeId()`. Never the legacy `grudge_<puter>` form. |
| `puter_id` | The real Puter account UUID (or `NULL`). | **Canonical** Puter column. `NULL` until the client onboards Puter and links it. Never a fabricated `GRUDGE-xxxx` value. |
| `server_wallet_address` / `server_wallet_index` | Custodial wallet derived by `wallet-service`. | Provisioned on create (best-effort). |

### Credential columns (each `UNIQUE` — one external account → at most one Grudge ID)
`discord_id`, `google_id`, `github_id`, `wallet_address`, `web3auth_id`,
`phone`, `email`, `puter_id`, `username`.

### Deprecated
`puter_uuid` — a duplicate Puter column added for the old links flow. Migration
`025_canonical_identity.sql` consolidates it into `puter_id`. **Do not write it.**

---

## 2. The one creation path — `accounts.js`

All account creation goes through **`src/accounts.js`**. No route runs its own
`INSERT INTO users` anymore.

```
createUser(db, fields)            → the single canonical INSERT
resolveOrCreateUser(db, opts)     → login | attach-to-session | create
provisionServerWallet(grudge_id)  → best-effort custodial wallet
generateGrudgeId()                → uuidv4()
```

### `createUser(db, fields)`
- `grudge_id` = UUID (generated if not supplied).
- `puter_id` is forced to a real UUID **or `NULL`** — any `GRUDGE-*` placeholder
  is stripped (`isFabricatedPuterId`).
- Columns are whitelisted (`INSERTABLE_COLUMNS`) so a stray key can never be
  injected into SQL. Values are always parameterised.
- Provisions a server wallet (never blocks signup if `wallet-service` is down).

### `resolveOrCreateUser(db, { field, value, sessionGrudgeId, extra })`
The heart of "single canonical ID". `field` must be one of `CREDENTIAL_COLUMNS`
(allow-listed — guards the dynamic SQL).

```
1. Found a user with field = value?        → return it (LOGIN). Bumps
                                              last_login; 403 if banned.
2. Else caller is authenticated
   (sessionGrudgeId) and that account
   doesn't yet have this credential?        → ATTACH credential to the session
                                              account. (Prevents a 2nd account
                                              when an existing player adds a new
                                              provider — e.g. a Discord user
                                              later onboards Puter.)
3. Else                                     → createUser() a new canonical row.
```

---

## 3. How each entry point uses it

| Route | Behaviour |
|---|---|
| `POST /auth/wallet` (Web3Auth) | `getOrCreateUser('wallet_address', …)` → `resolveOrCreateUser` |
| `POST /auth/discord/exchange`, `…/google/callback`, `…/github/callback` | `getOrCreateUser('<provider>_id', …)` |
| `POST /auth/google/exchange`, `…/github/exchange`, `/auth/phone-verify`, `/auth/register`, `/auth/guest` | `accounts.createUser({ … })` |
| `POST /auth/puter` | Looks up by **`puter_id`**; creates via `createUser({ puter_id, … })` |
| `POST /auth/puter-link` | Attaches `puter_id` to the authenticated account (409 on conflict) |
| `POST /identity/link-puter` | **Session-aware** `resolveOrCreateUser('puter_id', …)` — see §4 |

`getOrCreateUser()` in `auth.js` is now a thin wrapper over
`accounts.resolveOrCreateUser()` (signature kept for its existing callers).

---

## 4. Guest → claimed lifecycle (Puter-first onboarding)

`POST /identity/link-puter` is the visitor entry point (every visitor becomes a
tracked player; temp players still generate PIP revenue).

```
Anonymous first visit (no session)         → create guest account
  { puter_id, is_guest:1, is_temp:1 }

Same Puter UUID returns                     → resolve existing (LOGIN)

Already-authenticated visitor onboards      → ATTACH puter_id to the session
Puter (Bearer token present)                  account — NO new account

Temp account claims (isTemp:false)          → promote: is_guest=0, is_temp=0
```

Because it passes `sessionGrudgeId` (decoded from the optional `Authorization:
Bearer` token) into `resolveOrCreateUser`, a Discord/Google/etc. user who later
runs Puter onboarding gets their **existing** Grudge ID back — not a duplicate.

---

## 5. Linking additional providers — `/auth/links/*` (`links.js`)

For a **logged-in** user attaching more providers. Provider catalogue
(`PROVIDERS`) maps each provider → its unique column.

| Endpoint | Purpose |
|---|---|
| `GET /auth/links` | List every provider + whether it's linked to the current user. |
| `POST /auth/links/start { provider }` | Begin an OAuth link; returns authorize URL with a 5-min, audience-scoped **link-intent** JWT as `state`. |
| `GET /auth/links/callback/:provider` | Provider redirect; verifies intent, then links — or redirects with `?status=conflict&conflictGrudgeId=…` if another account owns it. |
| `DELETE /auth/links/:provider` | Unlink. Refuses if it would leave the user with **zero** sign-in methods (last-provider safeguard). |
| `POST /auth/links/merge { otherToken }` | Merge another account (proven by its token) **into** the current one. |

OAuth links use **COALESCE** so they never overwrite a value the user already
set (e.g. a custom avatar).

---

## 6. Conflicts & merging (no silent data loss)

**Rule: never steal a credential that already belongs to another Grudge ID.**

- `POST /identity/link-auth` and the `links.js` OAuth callback both detect when
  a credential is owned by a different `grudge_id` and return **`409`** with
  `conflictGrudgeId` instead of nulling the other account (the old, lossy
  behaviour). The client then offers a real merge.
- `POST /auth/links/merge` performs the real merge in a **transaction**:
  1. Copy provider columns + display extras the target is missing.
  2. Re-assign rows in ~20 dependent game tables (`characters`, `inventory`,
     `gold_transactions`, `island_state`, `pvp_*`, `user_achievements`,
     `gouldstones`, `launch_tokens`, …) from source → target.
  3. Delete the source `users` row.

> ⚠️ **Security:** merging two already-populated accounts is account-takeover
> sensitive. The caller must present a valid token for **both** the target
> (their session) and the source (`otherToken`). Require an explicit user
> confirmation step in the UI before calling `/auth/links/merge`.

---

## 7. Sessions

- `issueToken(user)` mints a 7-day JWT carrying `grudge_id`, `role`,
  `discord_id`, `wallet_address`, `server_wallet_address`, `puter_id`, etc.
- `grudge_sso` cookie (`httpOnly`, `secure`, `sameSite=none`, 7d) provides SSO
  across `*.grudge-studio.com`; apps call `GET /auth/sso-check?return=` to pick
  it up. **Keep player data out of `localStorage`** — rely on the cookie + a
  verify call.

---

## 8. Data migration

`migrations/025_canonical_identity.sql` (idempotent, MySQL 8):
1. Clears fabricated `puter_id` (`LIKE 'GRUDGE-%'`) → `NULL`.
2. Backfills `puter_id` from the deprecated `puter_uuid` (collision-safe).
3. Promotes `web3auth_id` to `UNIQUE`; re-asserts `puter_id` `UNIQUE`.

> **Pre-existing duplicates** (the same human who already had two rows from two
> entry points) are *not* auto-merged — there's no shared credential to prove
> they're the same person. They reconcile going forward via the 409 → merge
> flow the first time a shared credential is presented.

---

## 9. Account tiers (roles)

`resolveRole(user)` → `master` (allow-listed: `racalvin`, `grudachain`,
`molochdagod`) › `admin` › `member` (paying) › `pleb` (active) › guest
(`is_guest`/`is_temp`). **TODO (security):** pin `master`/`admin` to a fixed
`grudge_id`/`puter_id` allow-list rather than display `username`, which is
spoofable.
