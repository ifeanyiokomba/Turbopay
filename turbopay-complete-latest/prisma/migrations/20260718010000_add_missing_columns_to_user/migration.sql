-- Migration: Add missing columns to User table for production
-- These columns exist in the schema but were not in the original migration history

-- Apple Sign-In support
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "appleId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "applePicture" TEXT;

-- Google OAuth support
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "googleId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "googlePicture" TEXT;

-- Country field
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "country" TEXT;

-- Failed-login lockout
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "loginFailCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "loginLockedUntil" TIMESTAMP(3);

-- Verified PII from KYC providers
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "dateOfBirth" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "gender" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "stateOfOrigin" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lga" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "town" TEXT;

-- MFA (TOTP authenticator)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mfaSecretEnc" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mfaEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mfaBackupCodesEnc" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mfaEnabledAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mfaLastStep" INTEGER;

-- Large Transaction Shield
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "largeTxShieldEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "largeTxThresholdKobo" INTEGER NOT NULL DEFAULT 100000;

-- Location Guard
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "locationGuardEnabled" BOOLEAN NOT NULL DEFAULT false;

-- NDPR/GDPR consent tracking
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "privacyPolicyAccepted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "privacyPolicyAcceptedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "marketingConsent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "marketingConsentAt" TIMESTAMP(3);

-- Make phone nullable (was NOT NULL in original migration)
ALTER TABLE "User" ALTER COLUMN "phone" DROP NOT NULL;

-- Create unique indexes for OAuth IDs
CREATE UNIQUE INDEX IF NOT EXISTS "User_googleId_key" ON "User"("googleId") WHERE "googleId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "User_appleId_key" ON "User"("appleId") WHERE "appleId" IS NOT NULL;

-- Create unique index for username
CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username") WHERE "username" IS NOT NULL;
