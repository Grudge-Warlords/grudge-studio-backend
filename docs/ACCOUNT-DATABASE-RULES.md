# Account Database Rules

*Authoritative as of 2026-04-28. Enforced by code (`shared/validate-env.js`), CI (`.github/workflows/db-discipline.yml`), and process (this doc).*

## The Rule

There is exactly **one** canonical place a Grudge Studio user account can live:

> **MySQL `grudge_game` on the production VPS, written through the `grudge-id` service.**

Every other database that ever held a `users` row is either retired or read-only-for-migration. **No service is permitted to create users anywhere else.**

## Why this rule exists

On 2026-04-28 we found **four** parallel account databases:

| DB | Users | Schema richness | Status |
|---|---|---|---|
| **MySQL `grudge_game`** | 82 | Full game state (gold, gbux, faction, race, class, role, ban state) | **Canonical** |
| ~~MySQL `mysql-l7kwy…` (Stack B)~~ | ~~18 stale~~ | duplicate of MySQL | **Deleted 2026-04-28** |
| Neon Postgres (`ep-lingering-bread`) | 35 | Auth-only (no game state) | **Retired — read-only for migration** |
| Supabase (`rdbkhvrpavhptxrmmwrc`) | unknown | Service role key broken (hex, not JWT) | **To delete — never went live** |

Username `GRUDACHAIN` exists in both MySQL and Neon. The other 35 Neon users + 78 MySQL users are disjoint. That means new-user code paths landed in different DBs depending on which entry point the user hit, and never reconciled. **That is the duplicate-account bug we observed.** This rule prevents recurrence.

## Per-service policy

| Service | MUST use | MUST NOT use |
|---|---|---|
| `grudge-id` (auth) | MySQL `grudge_game` | Postgres, Supabase |
| `account-api` | MySQL `grudge_game` | Postgres, Supabase |
| `game-api` | MySQL `grudge_game` | Postgres, Supabase |
| `launcher-api` | MySQL `grudge_game` | Postgres, Supabase |
| `ws-service` | MySQL `grudge_game` | Postgres, Supabase |
| `wallet-service` | MySQL `grudge_game` | Postgres, Supabase |
| `asset-service` | MySQL + R2 (`grudge-assets`) | other R2 buckets, Postgres, Supabase |
| `ai-agent` | (no user-account writes) | any user-account writes |
| `grudge-bridge` | MySQL `grudge_game` (read-only ok) | Postgres, Supabase |
| `grudge-headless` | (no user-account writes) | all account DBs |
| `puter-workers` | Puter KV/FS only | MySQL, Postgres, Supabase |

## Forbidden environment variables

Any service in the table above **MUST refuse to start** if any of these env vars is present in its container environment. Enforced by `shared/validate-env.js::validateCanonicalDB()`.

- `GRUDGE_ACCOUNT_DB`
- `GRUDGE_ACCOUNT_DB_UNPOOLED`
- `NEON_DATABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL` (only forbidden if it points at `neon.tech` or `supabase.co`)

## Forbidden npm imports

Service code under `services/grudge-id/`, `services/account-api/`, `services/game-api/`, `services/launcher-api/`, `services/ws-service/`, `services/wallet-service/`, `services/asset-service/`, `services/ai-agent/`, `services/grudge-bridge/`, and `shared/` MUST NOT import:

- `pg`, `postgres`, `pg-pool`, `pg-promise` — Postgres drivers
- `@supabase/supabase-js`, `@supabase/auth-helpers-*` — Supabase client
- `@neondatabase/serverless` — Neon driver

Enforced by `.github/workflows/db-discipline.yml` on every PR + push to `main`.

**Exception:** `services/puter-workers/` and any one-shot `scripts/migrate-*.js` may use whatever they need.

## Reading legacy data is OK only via clearly-named scripts

If you need to look at Neon to migrate the 35 stale users, write `scripts/migrate-neon-users.js` (or similar) and run it ad-hoc. Long-running services may not import a Postgres driver.

## Migration plan for the 35 Neon users

1. Compare full email/discord_id/google_id/github_id/wallet_address columns between Neon and MySQL.
2. For each Neon user with NO match in MySQL, INSERT into `grudge_game.users` (preserving `created_at`).
3. For the one collision (`GRUDACHAIN`), keep MySQL as authoritative; document the merge in this file.
4. After migration, archive a final dump of Neon to `/opt/backups/neon-users-final-YYYYMMDD.sql.gz` and delete the Neon project from the dashboard.

This migration script is a separate task; until it lands, the 35 Neon users remain unreachable from the canonical Grudge Warlords flows. Acceptable risk because none of those 35 users have characters/inventory/wallet data in the Grudge Warlords tables.

## Supabase decision

The service role key in `.env` is a hex hash, not a JWT. The Supabase project never went live for accounts. **Action:** delete the Supabase project entirely. If you later need a Supabase-shaped piece for analytics or feature flags, scope it to a clearly-named non-account use and document it here.

## How to add a new service

If you create a new service in `services/<name>/`:

1. Add it to the per-service policy table above (Section "Per-service policy") with explicit MUST-use/MUST-NOT-use entries.
2. In its `index.js`, call:

   ```js
   const { validateCanonicalDB } = require('../../shared/validate-env');
   validateCanonicalDB({ serviceName: '<name>' });
   ```

3. The CI workflow `db-discipline.yml` will automatically scan `services/<name>/` for forbidden imports — no change needed to the workflow unless your service is a documented exception.

## Drift detection

The current backup of MySQL `grudge_game` lives at `/opt/backups/stack-a-grudge_game-YYYYMMDD-HHMMSS.sql.gz`. A nightly cron (TODO — set up on the buddy box once it's online) compares user counts against the previous day. Spike detected = a service is bypassing this rule. Investigate immediately.
