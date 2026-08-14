/**
 * TEST DATABASE SAFETY — shared guard used by vitest.setup.ts and by any
 * script or test that performs DESTRUCTIVE database operations.
 *
 * The guard exists so that migrations, resets, truncations, and fixture
 * cleanup can NEVER accidentally run against a production / staging /
 * development database. Only hosts explicitly listed in
 * TEST_DB_ALLOWED_HOSTS (default: localhost, 127.0.0.1, ::1) are permitted
 * unless TEST_DB_ALLOW_REMOTE=1 is set AND the URL is provided via
 * DATABASE_URL_TEST (an explicit, deliberate remote test database).
 *
 * PURE MODULE — imports nothing from the app, so it can be loaded from
 * vitest.setup.ts before Prisma / env validation run.
 */

export interface TestDbResolution {
  /** The resolved URL that tests will run against. */
  url: string;
  /** True when the URL was explicitly provided via DATABASE_URL_TEST. */
  explicit: boolean;
  /** Human-readable reason for the resolution (for error messages). */
  source: string;
}

/** Hosts that are always safe for destructive test operations. */
const DEFAULT_ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "::1", ""]);

/**
 * Resolve the URL tests should run against. NEVER falls back to a remote
 * production DATABASE_URL. Throws when only a remote DATABASE_URL is present.
 */
export function resolveTestDatabaseUrl(
  env: Record<string, string | undefined>
): TestDbResolution {
  const explicit = env.DATABASE_URL_TEST;
  if (explicit) {
    return { url: explicit, explicit: true, source: "DATABASE_URL_TEST" };
  }

  // No explicit test URL. A LOCALHOST DATABASE_URL is acceptable (e.g. a CI
  // service container or a locally-started postgres) — a remote one is not.
  const fallback = env.DATABASE_URL;
  if (fallback) {
    const host = hostOf(fallback);
    const isLocal = DEFAULT_ALLOWED_HOSTS.has(host);
    if (isLocal) {
      return { url: fallback, explicit: false, source: `DATABASE_URL (local host: ${host})` };
    }
    throw new Error(
      `[test-safety] Refusing to run tests against a remote DATABASE_URL (host "${host}").\n` +
      `The test environment must NEVER touch production/staging data.\n` +
      `Fix: run "bash scripts/test-db/setup.sh" to provision an isolated local test DB, or\n` +
      `export DATABASE_URL_TEST=<isolated test database URL>.`
    );
  }

  throw new Error(
    "[test-safety] No test database URL found. Run " +
    '"bash scripts/test-db/setup.sh" (provisions an isolated local PostgreSQL on port 5433) ' +
    "or export DATABASE_URL_TEST."
  );
}

/** Parse the hostname out of a postgres:// URL (defensive). */
export function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname;
  } catch {
    // Not a valid URL — extract between @ and the first : or / naively.
    const m = url.match(/@([^:/]+)/);
    return m ? m[1] : "";
  }
}

/**
 * Hard guard for destructive operations. Throws unless the target host is in
 * the allow-list (default: localhost / loopback). Passing `allowRemote` (only
 * ever set from TEST_DB_ALLOW_REMOTE=1) permits a non-loopback host but still
 * requires the URL to have come from DATABASE_URL_TEST (an explicit remote
 * test database is the operator's deliberate choice).
 */
export function assertSafeTestDatabase(opts: {
  url: string;
  allowRemote?: boolean;
}): void {
  const { url, allowRemote = false } = opts;
  const host = hostOf(url);

  if (DEFAULT_ALLOWED_HOSTS.has(host)) return;

  if (allowRemote) {
    // Explicitly opted-in remote test database. Loud warning is still emitted
    // so an accidental TEST_DB_ALLOW_REMOTE=1 in a dev shell can't silently
    // point at production.
    if (!url.startsWith("postgres") && !url.startsWith("postgresql")) {
      throw new Error(`[test-safety] Unsupported test URL scheme for "${host}".`);
    }
    // eslint-disable-next-line no-console
    console.warn(`[test-safety] TEST_DB_ALLOW_REMOTE=1: tests will run against remote host "${host}". Verify this is a dedicated test database.`);
    return;
  }

  throw new Error(
    `[test-safety] Destructive test operations are blocked: target host "${host}" is not in the allow-list ` +
    `(${[...DEFAULT_ALLOWED_HOSTS].filter(Boolean).join(", ")}).\n` +
    `This protects production/staging/dev data. Set DATABASE_URL_TEST to an isolated test database, or ` +
    `TEST_DB_ALLOW_REMOTE=1 only if you deliberately target a remote TEST database.`
  );
}
