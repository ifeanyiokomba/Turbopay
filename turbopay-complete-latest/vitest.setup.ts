/**
 * Vitest setup — loads .env.local then .env before any test module imports.
 * Without this, env.ts validation fails because DATABASE_URL is undefined.
 * .env.local is loaded first (contains DATABASE_URL and secrets); .env is
 * loaded second as a fallback (overridden by .env.local values).
 *
 * IMPORTANT: Appends ?pgbouncer=true to DATABASE_URL when using Supabase's
 * connection pooler. Supabase uses PgBouncer in transaction mode, which
 * conflicts with Prisma's prepared statements (error: "prepared statement
 * already exists"). The pgbouncer=true flag tells Prisma to use simple
 * queries instead of prepared statements.
 */
import { config } from "dotenv";
import path from "path";

// FORCE test environment BEFORE dotenv loads. If the parent shell exports
// NODE_ENV (e.g. a legacy SDK value like "sandbox"), env.ts validation
// rejects it and every test file fails to load. Tests always run as
// NODE_ENV=test regardless of the shell.
// NODE_ENV is typed as read-only in @types/node — cast to assign.
(process.env as Record<string, string | undefined>)["NODE_ENV"] = "test";

config({ path: path.resolve(__dirname, ".env.local") });
config({ path: path.resolve(__dirname, ".env") });

// ─── TEST DATABASE ISOLATION ────────────────────────────────────────────
// Tests must never run against the production database. The production
// DATABASE_URL lives in .env.local (a remote Supabase pooler) and would be
// loaded above. Prefer DATABASE_URL_TEST when the developer/CI provides it;
// otherwise warn loudly when the resolved URL points at a non-local host.
const testUrl = process.env.DATABASE_URL_TEST;
if (testUrl) {
  process.env.DATABASE_URL = testUrl;
  if (process.env.DIRECT_URL) process.env.DIRECT_URL = testUrl;
} else {
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname;
    } catch {
      return "";
    }
  })();
  const isLocal =
    host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "";
  if (!isLocal) {
    console.error(
      "[vitest] WARNING: DATABASE_URL points at a REMOTE database (" +
        host +
        "). Tests may hit non-test data! Set DATABASE_URL_TEST to an isolated test database."
    );
  }
}

// Fix Supabase PgBouncer + Prisma prepared statement conflict
if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("pgbouncer=true")) {
  const separator = process.env.DATABASE_URL.includes("?") ? "&" : "?";
  process.env.DATABASE_URL = `${process.env.DATABASE_URL}${separator}pgbouncer=true`;
}
