-- Migration: Add missing columns and performance indexes
-- Brings the database schema in line with the current Prisma schema.
-- All ALTER TABLE statements use IF NOT EXISTS for safety.

-- ============================================================
-- USER TABLE — missing columns
-- ============================================================

-- OAuth support
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "googleId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "googlePicture" TEXT;

-- Failed-login lockout (mirrors pin lockout pattern)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "loginFailCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "loginLockedUntil" TIMESTAMP(3);

-- Verified PII from KYC providers
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "dateOfBirth" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "stateOfOrigin" TEXT;
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

-- ============================================================
-- SESSION TABLE — refresh token + iframe token columns
-- ============================================================

ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "refreshTokenHash" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "refreshExpiresAt" TIMESTAMP(3);
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "iframeTokenHash" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "iframeExpiresAt" TIMESTAMP(3);

-- ============================================================
-- TRANSACTION TABLE — lifecycle state column
-- ============================================================

ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "state" TEXT;

-- ============================================================
-- PERFORMANCE INDEXES
-- ============================================================
-- Covers query patterns from admin dashboard, cron workers, and
-- high-traffic API routes not addressed by the initial migration.

-- User: OAuth login lookup (googleId is nullable, partial index)
CREATE UNIQUE INDEX IF NOT EXISTS "User_googleId_key" ON "User"("googleId") WHERE "googleId" IS NOT NULL;

-- Session: refresh token lookup (refresh endpoint)
CREATE UNIQUE INDEX IF NOT EXISTS "Session_refreshTokenHash_key" ON "Session"("refreshTokenHash") WHERE "refreshTokenHash" IS NOT NULL;

-- Session: iframe token lookup (iframe auth)
CREATE INDEX IF NOT EXISTS "Session_iframeTokenHash_idx" ON "Session"("iframeTokenHash") WHERE "iframeTokenHash" IS NOT NULL;

-- ProviderHealthCheck: admin dashboard health timeline
-- (initial migration has this but without DESC on checkedAt)
DROP INDEX IF EXISTS "ProviderHealthCheck_providerConfigId_checkedAt_idx";
CREATE INDEX IF NOT EXISTS "ProviderHealthCheck_providerConfigId_checkedAt_idx" ON "ProviderHealthCheck"("providerConfigId", "checkedAt" DESC);

-- ScheduledPayment: cron execution query
CREATE INDEX IF NOT EXISTS "ScheduledPayment_status_nextExecutionAt_idx" ON "ScheduledPayment"("status", "nextExecutionAt") WHERE "status" = 'ACTIVE';

-- AsyncTask: queue worker pending task query
CREATE INDEX IF NOT EXISTS "AsyncTask_status_type_createdAt_idx" ON "AsyncTask"("status", "type", "createdAt") WHERE "status" = 'PENDING';

-- IdempotencyRecord: cleanup of expired records
CREATE INDEX IF NOT EXISTS "IdempotencyRecord_createdAt_idx" ON "IdempotencyRecord"("createdAt");

-- AmlFlag: unresolved flags for compliance dashboard
CREATE INDEX IF NOT EXISTS "AmlFlag_resolved_createdAt_idx" ON "AmlFlag"("resolved", "createdAt") WHERE "resolved" = false;

-- ComplianceCase: open cases for compliance team
CREATE INDEX IF NOT EXISTS "ComplianceCase_status_createdAt_idx" ON "ComplianceCase"("status", "createdAt") WHERE "status" IN ('OPEN', 'UNDER_REVIEW');

-- SupportTicket: assigned tickets for support agents
CREATE INDEX IF NOT EXISTS "SupportTicket_assignedTo_status_idx" ON "SupportTicket"("assignedTo", "status") WHERE "assignedTo" IS NOT NULL;

-- BillSwiftBulkJob: bulk processor pending job query
CREATE INDEX IF NOT EXISTS "BillSwiftBulkJob_status_createdAt_idx" ON "BillSwiftBulkJob"("status", "createdAt") WHERE "status" IN ('PENDING', 'PROCESSING');

-- WebhookEvent: retry worker failed event query
CREATE INDEX IF NOT EXISTS "WebhookEvent_status_receivedAt_idx" ON "WebhookEvent"("status", "receivedAt") WHERE "status" IN ('FAILED', 'PENDING');

-- Transaction: state machine queries (stuck-tx detection cron)
CREATE INDEX IF NOT EXISTS "Transaction_state_idx" ON "Transaction"("state") WHERE "state" IS NOT NULL;

-- NotificationLog: retry worker failed notification query
-- (initial migration has status_createdAt but without the WHERE filter)
DROP INDEX IF EXISTS "NotificationLog_status_createdAt_idx";
CREATE INDEX IF NOT EXISTS "NotificationLog_status_createdAt_idx" ON "NotificationLog"("status", "createdAt") WHERE "status" IN ('FAILED', 'PERMANENTLY_FAILED', 'PENDING');
