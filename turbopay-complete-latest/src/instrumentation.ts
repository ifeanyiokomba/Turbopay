/**
 * Next.js Instrumentation Hook
 *
 * Runs once at application startup, BEFORE any route handler executes.
 * This guarantees env validation fires before the app serves traffic,
 * regardless of which route is hit first.
 *
 * See: https://nextjs.org/docs/app/api-reference/functions/instrumentation
 */

export async function register() {
  // Validate environment variables at startup (fail-fast).
  // This import triggers the Zod validation in env.ts.
  // If any required production variable is missing, the app will not start.
  await import("@/lib/env");
}
