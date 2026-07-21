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

config({ path: path.resolve(__dirname, ".env.local") });
config({ path: path.resolve(__dirname, ".env") });

// Fix Supabase PgBouncer + Prisma prepared statement conflict
if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("pgbouncer=true")) {
  const separator = process.env.DATABASE_URL.includes("?") ? "&" : "?";
  process.env.DATABASE_URL = `${process.env.DATABASE_URL}${separator}pgbouncer=true`;
}
