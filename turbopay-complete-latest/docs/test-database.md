# Test Database — TurboPay

How the automated test suite gets an isolated PostgreSQL database, how it is
provisioned, and how to troubleshoot it.

## TL;DR

```bash
npm test          # auto-provisions an isolated local PostgreSQL and runs vitest
npm run test:only # just run vitest (DB must already be set up)
```

No manual database setup is required on a machine with PostgreSQL 16 binaries
installed. Tests **never** touch the production/dev/staging database.

---

## What `.testdb/` is

`.testdb/` is a **generated, git-ignored** directory that contains a fully
isolated PostgreSQL **cluster** (its own data directory, its own port, its own
auth) dedicated to running tests:

```
.testdb/
├── pgdata/          # the cluster's data directory (initdb output)
└── postgres.log     # server log (check this when the cluster fails to start)
```

It is created on first run by `scripts/test-db/setup.sh` and is safe to delete
at any time — the next `npm test` recreates it from scratch. It is ignored by
Git (`.gitignore` has `.testdb/`), so it is never committed.

## How `scripts/test-db/setup.sh` works

`setup.sh` resolves a **safe** test database using this order (first match wins):

1. **`DATABASE_URL_TEST` already in the environment** (explicit, trusted) →
   run migrations against it and exit.
2. **`DATABASE_URL` pointing at a localhost host that is TCP-reachable** —
   e.g. a CI PostgreSQL service container on `localhost:5432`. Used as the
   test URL; migrations applied; exit.
3. **Otherwise — provision a dedicated isolated cluster:**
   - own data dir: `<project>/.testdb/pgdata`
   - own port: **5433** (never 5432, where a dev/prod cluster may run)
   - trust auth, bound to `127.0.0.1` only
   - writes `.env.test` (containing `DATABASE_URL_TEST`) and applies migrations.

The script is **idempotent** — safe to run on every `npm test`.

PostgreSQL 16 binaries are located in this order: `$PG_BIN` env var, the common
Windows install path (`C:\Program Files\PostgreSQL\16\bin`), or `initdb` /
`pg_ctl` on `PATH`.

## How `DATABASE_URL_TEST` is used

`vitest.setup.ts` resolves the URL tests run against, in order:

1. `DATABASE_URL_TEST` already in the process environment (CI sets this, or a
   developer exports it).
2. `DATABASE_URL_TEST` from `.env.test` (written by `setup.sh`).
3. A `DATABASE_URL` that points at a **localhost** host (CI service container).

It then sets `process.env.DATABASE_URL`/`DIRECT_URL` to that value **before**
Prisma loads. **The test environment never falls back to a remote
`DATABASE_URL`** — if only a remote URL exists, setup fails fast with
instructions instead of silently running tests against production/staging data.

`.env.test` is git-ignored (`.gitignore` has `.env*`).

## How migrations are applied

`setup.sh` runs `npx prisma migrate deploy` against the resolved test database
on every run. `migrate deploy` only applies **pending** migrations, so repeated
runs are cheap and idempotent. All four Prisma migrations apply cleanly to the
test database.

## How test data is initialized

Each DB-backed test file creates exactly the fixtures it needs in
`beforeAll`/`beforeEach` and cleans them up in `afterAll`/`afterEach` (see e.g.
`src/lib/turbopay/__tests__/ledger.test.ts`). There is no global seed — the
suite is reproducible from an empty (migrated) database.

## How `npm test` provisions the test environment

```
npm test
  └─ bash scripts/test-db/setup.sh   # resolve + provision + migrate
       └─ vitest run                 # run the suite
```

If `DATABASE_URL_TEST` or a reachable localhost `DATABASE_URL` already exists,
the setup step is a no-op apart from the migration check — so repeated runs are
fast.

## How to reset/recreate the test environment safely

```bash
# Stop the isolated cluster and delete its data directory
bash scripts/test-db/teardown.sh

# (optional) remove any generated env file
rm -f .env.test

# Next `npm test` provisions a fresh cluster + applies migrations
npm test
```

This is completely safe: the isolated cluster on port 5433 is separate from any
dev/prod cluster, and the safety guard below refuses destructive operations
against non-loopback hosts.

## How CI provisions PostgreSQL

`.github/workflows/ci.yml` (repo root) starts a `postgres:16-alpine` **service
container** on `localhost:5432` and sets `DATABASE_URL` /
`DIRECT_URL` to it. `npm test` → `setup.sh` detects the reachable localhost
`DATABASE_URL` (case 2 above) and uses it directly — no cluster provisioning
happens in CI.

## Troubleshooting test DB failures

| Symptom | Likely cause | Fix |
|---|---|---|
| `pg_ctl start failed` | Cluster data dir corrupted or port 5433 occupied | `bash scripts/test-db/teardown.sh` then `npm test`; check `.testdb/postgres.log` |
| `initdb failed` | Missing PostgreSQL 16 binaries | Install PostgreSQL 16 or `export PG_BIN=/path/to/postgres/bin` |
| `Refusing to run tests against a remote DATABASE_URL` | Only a remote `DATABASE_URL` exists (no `DATABASE_URL_TEST`, no localhost URL) | Run `bash scripts/test-db/setup.sh`, or `export DATABASE_URL_TEST=<isolated test db URL>` |
| Tests time out in `beforeAll` | Test DB unreachable | Verify the resolved URL is reachable: `npx tsx -e "console.log(process.env.DATABASE_URL_TEST)"` after setup, or check the Postgres service logs |
| `lockfile had changes, but lockfile is frozen` (CI) | `bun.lock` out of sync with `package.json` | Run `bun install` locally and commit the regenerated lockfile |

## Safety guarantees

`src/lib/turbopay/test-safety.ts` enforces:

- Destructive test operations (`deleteMany`, migrations, resets, truncation)
  are **only** permitted against hosts in the allow-list (default:
  `localhost`, `127.0.0.1`, `::1`).
- A remote target requires an explicit `TEST_DB_ALLOW_REMOTE=1` **and** a
  `DATABASE_URL_TEST` URL — and even then a loud warning is emitted.
- The suite **fails fast** rather than ever falling back to a production URL.

This is what guarantees automated tests can never accidentally execute
destructive operations against the production/staging/dev database.
