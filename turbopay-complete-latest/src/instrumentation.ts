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

  // Auto-apply missing DB columns on startup (idempotent — all use IF NOT EXISTS).
  // This ensures the schema stays in sync even if migrations weren't run manually.
  try {
    const { PrismaClient } = await import("@prisma/client");
    const db = new PrismaClient({ log: [] });
    await db.$executeRawUnsafe(`
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "appleId" TEXT;
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "applePicture" TEXT;
    `);
    // Create unique index only if it doesn't exist
    await db.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'User_appleId_key') THEN
          CREATE UNIQUE INDEX "User_appleId_key" ON "User"("appleId") WHERE "appleId" IS NOT NULL;
        END IF;
      END $$;
    `);
    await db.$disconnect();
  } catch (e) {
    // Non-fatal: startup migration is best-effort. If it fails, the app can
    // still start — columns that already exist won't cause errors, and missing
    // columns will fail at query time with a clear Prisma error.
    console.warn("[instrumentation] Startup migration skipped:", (e as Error)?.message);
  }
}
