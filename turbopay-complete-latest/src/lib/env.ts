import { z } from "zod";

/**
 * ENVIRONMENT VARIABLE VALIDATION
 *
 * Validated once at module load. Any missing/invalid required variable throws
 * a clear error at startup (fail-fast) rather than failing mid-transaction.
 *
 * During `next build`, NODE_ENV=production but env vars may not be set locally.
 * We skip strict validation during build (NEXT_BUILD is set by Next.js) so the
 * build succeeds. At runtime on Vercel, the real env vars are injected.
 */

const isBuilding = !!process.env.NEXT_BUILD;

// ── NODE_ENV normalization ──────────────────────────────────────────────
// `NODE_ENV` may carry a legacy value from the environment (the old SDK used
// "sandbox", and this repo's shell exports it). A strict throw here would
// break `next build`, `next dev`, and vitest for anyone with such a value
// exported. Coerce unknown values to a known one with a loud warning instead
// — the genuinely critical checks (DATABASE_URL, and the production-only PII /
// webhook / cron secrets below) remain fail-fast.
//
// IMPORTANT: read via BRACKET access. Turbopack statically inlines the
// dotted form `process.env.NODE_ENV` to "production" at build time (the
// value seen by build workers), making any runtime check against it dead
// code while `safeParse(process.env)` below still sees the real value.
const rawNodeEnv = (process.env as Record<string, string | undefined>)["NODE_ENV"];
if (rawNodeEnv && !["development", "test", "production"].includes(rawNodeEnv)) {
  console.warn(
    `[env] Unknown NODE_ENV "${rawNodeEnv}" — coercing to ${isBuilding ? "production" : "development"}. ` +
    "Set NODE_ENV=development|test|production explicitly to silence this warning."
  );
  (process.env as Record<string, string | undefined>)["NODE_ENV"] = isBuilding ? "production" : "development";
}

const envSchema = z.object({
  // Database — PostgreSQL in production, SQLite file for local dev.
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // PII encryption key — required in production.
  TURBOPAY_PII_KEY: (process.env.NODE_ENV === "production" && !isBuilding)
    ? z.string().min(16, "TURBOPAY_PII_KEY must be at least 16 characters in production")
    : z.string().optional(),

  // Monnify webhook secret — required in production (prevents forged funding).
  TURBOPAY_MONNIFY_WEBHOOK_SECRET: (process.env.NODE_ENV === "production" && !isBuilding)
    ? z.string().min(16, "TURBOPAY_MONNIFY_WEBHOOK_SECRET must be set in production")
    : z.string().optional(),

  // Cron secret — required in any non-dev/test environment (prevents forged cron invocations).
  // Staging/UAT environments must set this — the dev/test fallback is a security risk
  // when the app is internet-accessible.
  CRON_SECRET: (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test" || isBuilding)
    ? z.string().optional()
    : z.string().min(16, "CRON_SECRET must be set in non-development environments"),

  // Redis — required in production for distributed rate limiting, sessions, and caching.
  // Without Redis, rate limits are per-instance and can be bypassed in multi-instance deployments.
  REDIS_URL: z.string().optional(),

  // Notification providers (optional until integrated).
  TERMII_API_KEY: z.string().optional(),
  TERMII_SENDER_ID: z.string().optional().default("Turbopay"),
  RESEND_API_KEY: z.string().optional(),

  // Provider credentials (production).
  MONNIFY_API_KEY: z.string().optional(),
  MONNIFY_SECRET_KEY: z.string().optional(),
  MONNIFY_CONTRACT_CODE: z.string().optional(),
  BAXI_API_KEY: z.string().optional(),
  DOJAH_APP_ID: z.string().optional(),
  DOJAH_PUBLIC_KEY: z.string().optional(),
  DOJAH_PRIVATE_KEY: z.string().optional(),

  // Webhook secrets — optional until provider partnerships are live.
  // Each provider's webhook handler checks its own secret via isDemoRequest().
  // If the secret is missing, webhooks silently 401 to dead-letter with no alarm.
  FLUTTERWAVE_WEBHOOK_SECRET: z.string().optional(),
  WISE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_ISSUING_WEBHOOK_SECRET: z.string().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  throw new Error("Invalid environment configuration. See errors above.");
}

export const env = parsed.data;

/** True when running in production. */
export const isProduction = env.NODE_ENV === "production";

/** True when the PII key is properly configured. */
export const hasPiiKey = !!env.TURBOPAY_PII_KEY && env.TURBOPAY_PII_KEY.length >= 16;

/** True when real Monnify webhook verification is active. */
export const hasWebhookSecret = !!env.TURBOPAY_MONNIFY_WEBHOOK_SECRET;

// Runtime security check: REDIS_URL missing in production
if (isProduction && !env.REDIS_URL) {
  console.error(
    "[SECURITY] REDIS_URL is not set in production. " +
    "Rate limits are per-instance and can be bypassed in multi-instance deployments. " +
    "Set REDIS_URL in your Vercel environment variables."
  );
}
