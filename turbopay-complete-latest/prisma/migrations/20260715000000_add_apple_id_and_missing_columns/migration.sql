-- Migration: Add Apple Sign-In columns and any remaining missing columns
-- All statements use IF NOT EXISTS for safety (idempotent).

-- Apple Sign-In support
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "appleId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "applePicture" TEXT;

-- Add unique index for appleId (partial — only non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS "User_appleId_key" ON "User"("appleId") WHERE "appleId" IS NOT NULL;
