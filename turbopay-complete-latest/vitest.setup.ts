/**
 * Vitest setup — test-database resolution + SAFETY GUARD.
 *
 * Resolution order (FIRST WIN WINS — dotenv never overrides an already-set
 * process.env key):
 *   1. `DATABASE_URL_TEST` already in the environment (CI sets this, or the
 *      developer exports it).
 *   2. `DATABASE_URL_TEST` from `.env.test` (written by
 *      `scripts/test-db/setup.sh`, which provisions an isolated local
 *      PostgreSQL cluster on port 5433).
 *   3. A `DATABASE_URL` that points at a LOCALHOST host (e.g. a CI service
 *      container) — used as the test URL.
 *
 * The test environment NEVER falls back to a remote `DATABASE_URL` (the
 * production Supabase pooler from `.env.local`). If only a remote URL is
 * available, setup FAILS FAST with instructions instead of silently running
 * tests against production/staging data.
 *
 * Safety: destructive test operations (deleteMany, truncation, migrations,
 * resets) are only permitted against a host listed in TEST_DB_ALLOWED_HOSTS.
 * Anything else aborts the suite before the first test runs.
 */
import { config } from "dotenv";
import path from "path";
import { resolveTestDatabaseUrl, assertSafeTestDatabase } from "@/lib/turbopay/test-safety";

// FORCE test environment BEFORE dotenv loads. If the parent shell exports
// NODE_ENV (e.g. a legacy SDK value like "sandbox"), env.ts validation
// rejects it and every test file fails to load. Tests always run as
// NODE_ENV=test regardless of the shell.
(process.env as Record<string, string | undefined>)["NODE_ENV"] = "test";

// ── Load order matters ───────────────────────────────────────────────────
// .env.test first (isolated test DB URL), then .env.local (production dev
// secrets — DATABASE_URL from here is NEVER used for tests), then .env.
config({ path: path.resolve(__dirname, ".env.test") });
config({ path: path.resolve(__dirname, ".env.local") });
config({ path: path.resolve(__dirname, ".env") });

// ── Test database resolution ─────────────────────────────────────────────
const resolved = resolveTestDatabaseUrl(process.env);
process.env.DATABASE_URL = resolved.url;
process.env.DIRECT_URL = resolved.url;

// Hard guard: any destructive test operation must target a safe host.
// Throws before the first test if the resolved URL is not in the allow-list.
assertSafeTestDatabase({ url: resolved.url, allowRemote: !!process.env.TEST_DB_ALLOW_REMOTE });

// Fix Supabase PgBouncer + Prisma prepared statement conflict (harmless for
// the local test cluster — Prisma simply uses the simple-query protocol).
if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("pgbouncer=true")) {
  const separator = process.env.DATABASE_URL.includes("?") ? "&" : "?";
  process.env.DATABASE_URL = `${process.env.DATABASE_URL}${separator}pgbouncer=true`;
}
