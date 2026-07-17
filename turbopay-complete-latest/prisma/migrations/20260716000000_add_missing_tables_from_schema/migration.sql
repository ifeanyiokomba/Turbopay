-- Migration: Add missing tables and columns from Prisma schema
-- These tables/columns exist in schema.prisma but were not in the initial migration.

-- ============================================================
-- USER TABLE — missing columns
-- ============================================================
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "country" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "gender" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lga" TEXT;

-- ============================================================
-- PROVIDERCONFIG TABLE — missing columns
-- ============================================================
ALTER TABLE "ProviderConfig" ADD COLUMN IF NOT EXISTS "costBasisPoints" INTEGER;
ALTER TABLE "ProviderConfig" ADD COLUMN IF NOT EXISTS "settlementSpeedMin" INTEGER;
ALTER TABLE "ProviderConfig" ADD COLUMN IF NOT EXISTS "capacityPerMin" INTEGER;
ALTER TABLE "ProviderConfig" ADD COLUMN IF NOT EXISTS "avgLatencyMs" DOUBLE PRECISION;
ALTER TABLE "ProviderConfig" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);
ALTER TABLE "ProviderConfig" ADD COLUMN IF NOT EXISTS "lastHealthStatus" TEXT;
ALTER TABLE "ProviderConfig" ADD COLUMN IF NOT EXISTS "lastHealthLatencyMs" INTEGER;

-- ============================================================
-- OTHER TABLES — missing columns
-- ============================================================
ALTER TABLE "FeeConfig" ADD COLUMN IF NOT EXISTS "markupBps" INTEGER;
ALTER TABLE "NotificationLog" ADD COLUMN IF NOT EXISTS "retryCount" INTEGER;
ALTER TABLE "NotificationLog" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
ALTER TABLE "VirtualCard" ADD COLUMN IF NOT EXISTS "panEnc" TEXT;
ALTER TABLE "VirtualCard" ADD COLUMN IF NOT EXISTS "cvvEnc" TEXT;
ALTER TABLE "VirtualCard" ADD COLUMN IF NOT EXISTS "expiryMonth" INTEGER;
ALTER TABLE "VirtualCard" ADD COLUMN IF NOT EXISTS "expiryYear" INTEGER;
ALTER TABLE "VirtualCard" ADD COLUMN IF NOT EXISTS "cardholderName" TEXT;
ALTER TABLE "SavingsProduct" ADD COLUMN IF NOT EXISTS "lastAutoSaveAt" TIMESTAMP(3);
ALTER TABLE "UserReward" ADD COLUMN IF NOT EXISTS "sourceTransactionId" TEXT;
ALTER TABLE "UserReward" ADD COLUMN IF NOT EXISTS "ruleId" TEXT;
ALTER TABLE "UserReward" ADD COLUMN IF NOT EXISTS "tier" INTEGER;

-- ============================================================
-- NEW TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS "Passkey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "deviceName" TEXT NOT NULL,
    "deviceType" TEXT NOT NULL DEFAULT 'singleDevice',
    "transports" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "Passkey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CurrencyLedgerEntry" (
    "id" TEXT NOT NULL,
    "currencyWalletId" TEXT NOT NULL,
    "entryType" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "refType" TEXT NOT NULL,
    "refId" TEXT,
    "pairId" TEXT,
    "balanceAfter" INTEGER NOT NULL,
    "description" TEXT,
    "immutable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CurrencyLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AsyncTask" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AsyncTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StripeCustomer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StripeCustomer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FxConfig" (
    "id" TEXT NOT NULL,
    "pair" TEXT NOT NULL,
    "fromCurrency" TEXT NOT NULL,
    "toCurrency" TEXT NOT NULL,
    "spreadBps" INTEGER NOT NULL DEFAULT 150,
    "platformFeeBps" INTEGER NOT NULL DEFAULT 50,
    "minAmountMinor" INTEGER NOT NULL DEFAULT 0,
    "maxAmountMinor" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FxConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FxRateSnapshot" (
    "id" TEXT NOT NULL,
    "pair" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "providerRef" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FxRateSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProviderCredentialVersion" (
    "id" TEXT NOT NULL,
    "providerConfigId" TEXT NOT NULL,
    "credentialsEnc" TEXT NOT NULL,
    "credentialKeys" TEXT NOT NULL,
    "changedBy" TEXT,
    "changedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderCredentialVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SanctionsEntry" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "listSource" TEXT NOT NULL,
    "country" TEXT,
    "entityType" TEXT NOT NULL DEFAULT 'INDIVIDUAL',
    "reason" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SanctionsEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ScreeningResult" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "nationality" TEXT,
    "matches" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'PASS',
    "screenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreeningResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ChatConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ChatMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorRole" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "body" TEXT NOT NULL,
    "attachments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Device" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "ip" TEXT,
    "trusted" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SecurityEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SecurityQuestion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answerHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityQuestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Testimonial" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "location" TEXT,
    "quote" TEXT NOT NULL,
    "rating" INTEGER NOT NULL DEFAULT 5,
    "avatarUrl" TEXT,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "display" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Testimonial_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OutboxEvent" (
    "id" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PaymentIntent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountKobo" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "recipient" TEXT,
    "metadata" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SettlementQueue" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "providerRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextRetryAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SettlementQueue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CronLock" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lockedBy" TEXT,
    "lockedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CronLock_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CurrencyWallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "balanceMinor" INTEGER NOT NULL DEFAULT 0,
    "lockedMinor" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurrencyWallet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "InternationalBeneficiary" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "bankName" TEXT,
    "accountNumber" TEXT,
    "swiftCode" TEXT,
    "routingNumber" TEXT,
    "mobileWallet" TEXT,
    "nickname" TEXT,
    "currency" TEXT NOT NULL,
    "isFavourite" BOOLEAN NOT NULL DEFAULT false,
    "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternationalBeneficiary_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SystemMetric" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemMetric_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PaymentFlowLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "contract" TEXT NOT NULL,
    "amountKobo" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "country" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "selectedProvider" TEXT,
    "selectionReason" TEXT,
    "selectionScore" INTEGER,
    "candidatesCount" INTEGER,
    "attemptsCount" INTEGER,
    "providerRef" TEXT,
    "providerStatus" TEXT,
    "providerError" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentFlowLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProviderCapability" (
    "id" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "supported" BOOLEAN NOT NULL DEFAULT true,
    "supportedCountries" TEXT,
    "supportedCurrencies" TEXT,
    "percentageFeeBps" INTEGER NOT NULL DEFAULT 0,
    "fixedFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "requestsPerMinute" INTEGER,
    "maxTransferAmount" INTEGER,
    "version" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderCapability_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PaymentRoutingDecision" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "contract" TEXT NOT NULL,
    "amountKobo" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "country" TEXT,
    "selectedProvider" TEXT NOT NULL,
    "selectionReason" TEXT NOT NULL,
    "selectionScore" INTEGER NOT NULL,
    "candidatesCount" INTEGER NOT NULL,
    "eliminatedCount" INTEGER NOT NULL,
    "factorScores" TEXT,
    "decisionMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentRoutingDecision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PaymentLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amountKobo" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "allowCustomAmount" BOOLEAN NOT NULL DEFAULT false,
    "minAmountKobo" INTEGER,
    "maxAmountKobo" INTEGER,
    "maxUses" INTEGER,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "metadata" TEXT,
    "providerRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PaymentLinkPayment" (
    "id" TEXT NOT NULL,
    "paymentLinkId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amountKobo" INTEGER NOT NULL,
    "feeKobo" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "payerEmail" TEXT,
    "payerName" TEXT,
    "provider" TEXT,
    "providerRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentLinkPayment_pkey" PRIMARY KEY ("id")
);

-- AsyncTask: queue worker pending task query
CREATE INDEX IF NOT EXISTS "AsyncTask_status_type_createdAt_idx" ON "AsyncTask"("status", "type", "createdAt") WHERE "status" = 'PENDING';
