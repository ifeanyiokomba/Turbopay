-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "username" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "country" TEXT,
    "passwordHash" TEXT,
    "googleId" TEXT,
    "googlePicture" TEXT,
    "appleId" TEXT,
    "applePicture" TEXT,
    "transactionPinHash" TEXT,
    "pinSetAt" TIMESTAMP(3),
    "pinFailCount" INTEGER NOT NULL DEFAULT 0,
    "pinLockedUntil" TIMESTAMP(3),
    "loginFailCount" INTEGER NOT NULL DEFAULT 0,
    "loginLockedUntil" TIMESTAMP(3),
    "bvn" TEXT,
    "nin" TEXT,
    "dateOfBirth" TEXT,
    "gender" TEXT,
    "stateOfOrigin" TEXT,
    "lga" TEXT,
    "town" TEXT,
    "kycTier" INTEGER NOT NULL DEFAULT 1,
    "kycStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "privacyPolicyAccepted" BOOLEAN NOT NULL DEFAULT false,
    "privacyPolicyAcceptedAt" TIMESTAMP(3),
    "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
    "marketingConsentAt" TIMESTAMP(3),
    "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "avatarUrl" TEXT,
    "bio" TEXT,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "mfaSecretEnc" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaBackupCodesEnc" TEXT,
    "mfaEnabledAt" TIMESTAMP(3),
    "mfaLastStep" INTEGER,
    "largeTxShieldEnabled" BOOLEAN NOT NULL DEFAULT false,
    "largeTxThresholdKobo" INTEGER NOT NULL DEFAULT 100000,
    "locationGuardEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "deviceInfo" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "refreshTokenHash" TEXT,
    "refreshExpiresAt" TIMESTAMP(3),
    "iframeTokenHash" TEXT,
    "iframeExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Passkey" (
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

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balanceKobo" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "entryType" TEXT NOT NULL,
    "amountKobo" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "refType" TEXT NOT NULL,
    "refId" TEXT,
    "pairId" TEXT,
    "balanceAfterKobo" INTEGER NOT NULL,
    "description" TEXT,
    "immutable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurrencyLedgerEntry" (
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

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amountKobo" INTEGER NOT NULL,
    "feeKobo" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "state" TEXT,
    "counterpartyName" TEXT,
    "counterpartyAccount" TEXT,
    "counterpartyBank" TEXT,
    "description" TEXT,
    "provider" TEXT,
    "providerRef" TEXT,
    "reversalOfId" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AsyncTask" (
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

-- CreateTable
CREATE TABLE "VirtualAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "bankCode" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'monnify',
    "providerRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VirtualAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeCustomer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StripeCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "nin" TEXT,
    "bvn" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "middleName" TEXT,
    "dob" TEXT,
    "gender" TEXT,
    "payload" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Beneficiary" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "bankCode" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'TURBOPAY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Beneficiary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "userId" TEXT,
    "endpoint" TEXT NOT NULL,
    "requestBody" TEXT,
    "responseBody" TEXT,
    "status" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "ip" TEXT,
    "deviceInfo" TEXT,
    "userAgent" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmlFlag" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmlFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillPayment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transactionId" TEXT,
    "category" TEXT NOT NULL,
    "provider" TEXT,
    "customer" TEXT NOT NULL,
    "customerName" TEXT,
    "product" TEXT,
    "amountKobo" INTEGER NOT NULL,
    "feeKobo" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "reference" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AirtimeDataPurchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transactionId" TEXT,
    "type" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "plan" TEXT,
    "amountKobo" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "reference" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'baxi',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AirtimeDataPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "channel" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "signature" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternationalTransfer" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceCurrency" TEXT NOT NULL,
    "sourceAmountMinor" INTEGER NOT NULL,
    "destinationCurrency" TEXT NOT NULL,
    "destinationAmountMinor" INTEGER NOT NULL,
    "rate" DECIMAL(65,30) NOT NULL,
    "feesMinor" INTEGER NOT NULL,
    "settlementCurrency" TEXT NOT NULL,
    "beneficiaryName" TEXT NOT NULL,
    "beneficiaryAccount" TEXT,
    "beneficiaryBank" TEXT,
    "beneficiaryCountry" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "providerRef" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternationalTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "providerRef" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "settlementCurrency" TEXT NOT NULL,
    "settlementAmountMinor" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "settledAt" TIMESTAMP(3),
    "reference" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "product" TEXT,
    "rollout" INTEGER NOT NULL DEFAULT 0,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlagOverride" (
    "id" TEXT NOT NULL,
    "flagId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureFlagOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeConfig" (
    "id" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'PERCENT',
    "value" INTEGER NOT NULL DEFAULT 0,
    "markupBps" INTEGER NOT NULL DEFAULT 0,
    "minFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "maxFeeMinor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FxConfig" (
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

-- CreateTable
CREATE TABLE "FxRateSnapshot" (
    "id" TEXT NOT NULL,
    "pair" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "providerRef" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FxRateSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillSwiftBulkJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "fileName" TEXT,
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "processedItems" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillSwiftBulkJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillSwiftBulkItem" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "productCode" TEXT NOT NULL,
    "customer" TEXT NOT NULL,
    "customerName" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "meterType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "providerRef" TEXT,
    "error" TEXT,
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillSwiftBulkItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "counterparty" TEXT,
    "token" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationRun" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "walletsChecked" INTEGER NOT NULL DEFAULT 0,
    "driftDetected" INTEGER NOT NULL DEFAULT 0,
    "driftCorrected" INTEGER NOT NULL DEFAULT 0,
    "metadata" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderConfig" (
    "id" TEXT NOT NULL,
    "contract" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'mock',
    "credentialsEnc" TEXT,
    "credentialKeys" TEXT,
    "config" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "healthCheckUrl" TEXT,
    "healthCheckIntervalSec" INTEGER NOT NULL DEFAULT 300,
    "lastHealthCheckAt" TIMESTAMP(3),
    "lastHealthStatus" TEXT,
    "lastHealthLatencyMs" INTEGER,
    "costBasisPoints" INTEGER NOT NULL DEFAULT 0,
    "settlementSpeedMin" INTEGER NOT NULL DEFAULT 60,
    "capacityPerMin" INTEGER NOT NULL DEFAULT 0,
    "avgLatencyMs" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderRoute" (
    "id" TEXT NOT NULL,
    "contract" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "providerConfigId" TEXT NOT NULL,
    "manualOverrideId" TEXT,
    "canaryPercent" INTEGER NOT NULL DEFAULT 0,
    "rules" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "failoverThreshold" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderHealthCheck" (
    "id" TEXT NOT NULL,
    "providerConfigId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "errorMessage" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderHealthCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderCredentialVersion" (
    "id" TEXT NOT NULL,
    "providerConfigId" TEXT NOT NULL,
    "credentialsEnc" TEXT NOT NULL,
    "credentialKeys" TEXT NOT NULL,
    "changedBy" TEXT,
    "changedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderCredentialVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "contract" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secretEnc" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "maxRetries" INTEGER NOT NULL DEFAULT 5,
    "retryDelaySec" INTEGER NOT NULL DEFAULT 60,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycTierLimit" (
    "id" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "product" TEXT NOT NULL DEFAULT 'turbopay',
    "singleTxMinor" INTEGER NOT NULL,
    "dailyTxMinor" INTEGER NOT NULL,
    "balanceMinor" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycTierLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmlPolicy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "policy" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmlPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeploymentProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "config" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeploymentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfigVersion" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "reason" TEXT,
    "changedBy" TEXT,
    "changedByName" TEXT,
    "version" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfigVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceCase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amlFlagId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "severity" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "notes" TEXT,
    "assignedTo" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SanctionsEntry" (
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

-- CreateTable
CREATE TABLE "ScreeningResult" (
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

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "channel" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "provider" TEXT,
    "messageId" TEXT,
    "errorMsg" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportNote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsernameHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsernameHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "identifier" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecoveryToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "referralCode" TEXT NOT NULL,
    "referredId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rewardKobo" INTEGER NOT NULL DEFAULT 0,
    "rewardType" TEXT NOT NULL DEFAULT 'WALLET_CREDIT',
    "campaignId" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rewardKobo" INTEGER NOT NULL DEFAULT 0,
    "rewardType" TEXT NOT NULL DEFAULT 'WALLET_CREDIT',
    "maxReferrals" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VirtualCard" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "providerCardId" TEXT,
    "last4" TEXT,
    "brand" TEXT,
    "type" TEXT NOT NULL DEFAULT 'VIRTUAL',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "balanceKobo" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "spendingLimitKobo" INTEGER,
    "metadata" TEXT,
    "panEnc" TEXT,
    "cvvEnc" TEXT,
    "expiryMonth" INTEGER,
    "expiryYear" INTEGER,
    "cardholderName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VirtualCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavingsProduct" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "targetAmountKobo" INTEGER,
    "currentAmountKobo" INTEGER NOT NULL DEFAULT 0,
    "interestRateBps" INTEGER NOT NULL DEFAULT 0,
    "lockUntil" TIMESTAMP(3),
    "autoSaveAmountKobo" INTEGER,
    "autoSaveFrequency" TEXT,
    "lastAutoSaveAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavingsProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavingsTransaction" (
    "id" TEXT NOT NULL,
    "savingsProductId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountKobo" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "reference" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavingsTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestmentProduct" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "provider" TEXT,
    "minAmountKobo" INTEGER NOT NULL,
    "maxAmountKobo" INTEGER,
    "expectedReturnBps" INTEGER,
    "duration" TEXT,
    "riskLevel" TEXT NOT NULL DEFAULT 'LOW',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvestmentProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserInvestment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "investmentProductId" TEXT NOT NULL,
    "amountKobo" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "expectedReturnKobo" INTEGER,
    "maturityDate" TIMESTAMP(3),
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserInvestment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceFlag" (
    "id" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "ServiceFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "ticketNumber" TEXT NOT NULL,
    "userId" TEXT,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "username" TEXT,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "assignedTo" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicketMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "authorRole" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "message" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportTicketMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicketAttachment" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "messageId" TEXT,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportTicketAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "smsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
    "ticketUpdates" BOOLEAN NOT NULL DEFAULT true,
    "transactionAlerts" BOOLEAN NOT NULL DEFAULT true,
    "securityAlerts" BOOLEAN NOT NULL DEFAULT true,
    "promotional" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpArticle" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tags" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "views" INTEGER NOT NULL DEFAULT 0,
    "helpfulCount" INTEGER NOT NULL DEFAULT 0,
    "unhelpfulCount" INTEGER NOT NULL DEFAULT 0,
    "authorId" TEXT,
    "authorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "identifier" TEXT NOT NULL,
    "recoveryType" TEXT NOT NULL,
    "channel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'INITIATED',
    "ip" TEXT,
    "userAgent" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "RecoveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Voucher" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "valueKobo" INTEGER NOT NULL DEFAULT 0,
    "valueBps" INTEGER NOT NULL DEFAULT 0,
    "maxDiscountKobo" INTEGER,
    "minSpendKobo" INTEGER NOT NULL DEFAULT 0,
    "eligibleProducts" TEXT,
    "excludedProducts" TEXT,
    "applicableKycTiers" TEXT,
    "newCustomerOnly" BOOLEAN NOT NULL DEFAULT false,
    "returningOnly" BOOLEAN NOT NULL DEFAULT false,
    "referralRequired" BOOLEAN NOT NULL DEFAULT false,
    "oneTimeUse" BOOLEAN NOT NULL DEFAULT true,
    "usageLimit" INTEGER NOT NULL DEFAULT 0,
    "perUserLimit" INTEGER NOT NULL DEFAULT 1,
    "campaignBudgetKobo" INTEGER,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "currencyRestriction" TEXT,
    "regionRestriction" TEXT,
    "providerRestriction" TEXT,
    "totalUsed" INTEGER NOT NULL DEFAULT 0,
    "totalDiscountKobo" INTEGER NOT NULL DEFAULT 0,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Voucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherRedemption" (
    "id" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transactionId" TEXT,
    "discountAppliedKobo" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoucherRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserReward" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "voucherId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "valueKobo" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "expiresAt" TIMESTAMP(3),
    "metadata" TEXT,
    "sourceTransactionId" TEXT,
    "ruleId" TEXT,
    "tier" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VirtualCardTransaction" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountKobo" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "merchant" TEXT,
    "merchantCategory" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "providerRef" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VirtualCardTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VirtualCardControl" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "onlinePaymentsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "internationalEnabled" BOOLEAN NOT NULL DEFAULT false,
    "atmEnabled" BOOLEAN NOT NULL DEFAULT false,
    "dailyLimitKobo" INTEGER,
    "monthlyLimitKobo" INTEGER,
    "merchantCategories" TEXT,
    "metadata" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VirtualCardControl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AddressVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "residentialAddress" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "lga" TEXT,
    "city" TEXT NOT NULL,
    "postalCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Nigeria',
    "documentType" TEXT NOT NULL,
    "documentPath" TEXT NOT NULL,
    "documentUploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewerId" TEXT,
    "reviewerName" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AddressVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatementRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3) NOT NULL,
    "filters" TEXT,
    "status" TEXT NOT NULL DEFAULT 'GENERATED',
    "filePath" TEXT,
    "emailTo" TEXT,
    "emailStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatementRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "disputeNumber" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transactionId" TEXT,
    "type" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountDisputedKobo" INTEGER,
    "resolution" TEXT,
    "resolutionNotes" TEXT,
    "assignedTo" TEXT,
    "slaDueAt" TIMESTAMP(3),
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisputeMessage" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "authorRole" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "message" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisputeAttachment" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledPayment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "nextExecutionAt" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "customDates" TEXT,
    "recipient" TEXT NOT NULL,
    "recipientName" TEXT,
    "bankName" TEXT,
    "amountKobo" INTEGER NOT NULL,
    "description" TEXT,
    "productCode" TEXT,
    "meterType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastExecutedAt" TIMESTAMP(3),
    "executionCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "recipient" TEXT,
    "recipientName" TEXT,
    "bankName" TEXT,
    "bankCode" TEXT,
    "productCode" TEXT,
    "productName" TEXT,
    "customerRef" TEXT,
    "meterType" TEXT,
    "defaultAmountKobo" INTEGER,
    "description" TEXT,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "lastUsedAt" TIMESTAMP(3),
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InAppNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "read" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "actionUrl" TEXT,
    "actionLabel" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InAppNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorRole" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "body" TEXT NOT NULL,
    "attachments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
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

-- CreateTable
CREATE TABLE "SecurityEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityQuestion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answerHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Testimonial" (
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

-- CreateTable
CREATE TABLE "OutboxEvent" (
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

-- CreateTable
CREATE TABLE "PaymentIntent" (
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

-- CreateTable
CREATE TABLE "SettlementQueue" (
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

-- CreateTable
CREATE TABLE "CronLock" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lockedBy" TEXT,
    "lockedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CronLock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurrencyWallet" (
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

-- CreateTable
CREATE TABLE "InternationalBeneficiary" (
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

-- CreateTable
CREATE TABLE "SystemMetric" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentFlowLog" (
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

-- CreateTable
CREATE TABLE "ProviderCapability" (
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

-- CreateTable
CREATE TABLE "PaymentRoutingDecision" (
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

-- CreateTable
CREATE TABLE "PaymentLink" (
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

-- CreateTable
CREATE TABLE "PaymentLinkPayment" (
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

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "User_appleId_key" ON "User"("appleId");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Passkey_credentialId_key" ON "Passkey"("credentialId");

-- CreateIndex
CREATE INDEX "Passkey_userId_idx" ON "Passkey"("userId");

-- CreateIndex
CREATE INDEX "Passkey_credentialId_idx" ON "Passkey"("credentialId");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- CreateIndex
CREATE INDEX "Wallet_status_idx" ON "Wallet"("status");

-- CreateIndex
CREATE INDEX "LedgerEntry_walletId_idx" ON "LedgerEntry"("walletId");

-- CreateIndex
CREATE INDEX "LedgerEntry_walletId_entryType_idx" ON "LedgerEntry"("walletId", "entryType");

-- CreateIndex
CREATE INDEX "LedgerEntry_refType_refId_idx" ON "LedgerEntry"("refType", "refId");

-- CreateIndex
CREATE INDEX "CurrencyLedgerEntry_currencyWalletId_idx" ON "CurrencyLedgerEntry"("currencyWalletId");

-- CreateIndex
CREATE INDEX "CurrencyLedgerEntry_currencyWalletId_entryType_idx" ON "CurrencyLedgerEntry"("currencyWalletId", "entryType");

-- CreateIndex
CREATE INDEX "CurrencyLedgerEntry_refType_refId_idx" ON "CurrencyLedgerEntry"("refType", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_reference_key" ON "Transaction"("reference");

-- CreateIndex
CREATE INDEX "Transaction_userId_idx" ON "Transaction"("userId");

-- CreateIndex
CREATE INDEX "Transaction_walletId_idx" ON "Transaction"("walletId");

-- CreateIndex
CREATE INDEX "Transaction_type_idx" ON "Transaction"("type");

-- CreateIndex
CREATE INDEX "Transaction_status_idx" ON "Transaction"("status");

-- CreateIndex
CREATE INDEX "Transaction_state_idx" ON "Transaction"("state");

-- CreateIndex
CREATE INDEX "Transaction_createdAt_idx" ON "Transaction"("createdAt");

-- CreateIndex
CREATE INDEX "Transaction_userId_direction_status_createdAt_idx" ON "Transaction"("userId", "direction", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_userId_type_createdAt_idx" ON "Transaction"("userId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_provider_status_createdAt_idx" ON "Transaction"("provider", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AsyncTask_status_type_createdAt_idx" ON "AsyncTask"("status", "type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VirtualAccount_accountNumber_key" ON "VirtualAccount"("accountNumber");

-- CreateIndex
CREATE INDEX "VirtualAccount_userId_idx" ON "VirtualAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StripeCustomer_userId_key" ON "StripeCustomer"("userId");

-- CreateIndex
CREATE INDEX "StripeCustomer_userId_idx" ON "StripeCustomer"("userId");

-- CreateIndex
CREATE INDEX "KycVerification_userId_idx" ON "KycVerification"("userId");

-- CreateIndex
CREATE INDEX "Beneficiary_userId_idx" ON "Beneficiary"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_key_key" ON "IdempotencyRecord"("key");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_userId_idx" ON "IdempotencyRecord"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_category_idx" ON "AuditLog"("category");

-- CreateIndex
CREATE INDEX "AuditLog_severity_idx" ON "AuditLog"("severity");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_category_createdAt_idx" ON "AuditLog"("userId", "category", "createdAt");

-- CreateIndex
CREATE INDEX "AmlFlag_userId_idx" ON "AmlFlag"("userId");

-- CreateIndex
CREATE INDEX "AmlFlag_resolved_idx" ON "AmlFlag"("resolved");

-- CreateIndex
CREATE INDEX "BillPayment_userId_idx" ON "BillPayment"("userId");

-- CreateIndex
CREATE INDEX "BillPayment_category_idx" ON "BillPayment"("category");

-- CreateIndex
CREATE INDEX "AirtimeDataPurchase_userId_idx" ON "AirtimeDataPurchase"("userId");

-- CreateIndex
CREATE INDEX "AirtimeDataPurchase_type_idx" ON "AirtimeDataPurchase"("type");

-- CreateIndex
CREATE INDEX "OtpCode_target_purpose_idx" ON "OtpCode"("target", "purpose");

-- CreateIndex
CREATE INDEX "WebhookEvent_provider_status_idx" ON "WebhookEvent"("provider", "status");

-- CreateIndex
CREATE INDEX "WebhookEvent_receivedAt_idx" ON "WebhookEvent"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_providerRef_key" ON "WebhookEvent"("provider", "providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "InternationalTransfer_reference_key" ON "InternationalTransfer"("reference");

-- CreateIndex
CREATE INDEX "InternationalTransfer_userId_idx" ON "InternationalTransfer"("userId");

-- CreateIndex
CREATE INDEX "InternationalTransfer_status_idx" ON "InternationalTransfer"("status");

-- CreateIndex
CREATE INDEX "InternationalTransfer_provider_providerRef_idx" ON "InternationalTransfer"("provider", "providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_providerRef_key" ON "Settlement"("providerRef");

-- CreateIndex
CREATE INDEX "Settlement_provider_status_idx" ON "Settlement"("provider", "status");

-- CreateIndex
CREATE INDEX "Settlement_status_idx" ON "Settlement"("status");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_key_key" ON "FeatureFlag"("key");

-- CreateIndex
CREATE INDEX "FeatureFlagOverride_userId_idx" ON "FeatureFlagOverride"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlagOverride_flagId_userId_key" ON "FeatureFlagOverride"("flagId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE INDEX "FeeConfig_product_active_idx" ON "FeeConfig"("product", "active");

-- CreateIndex
CREATE UNIQUE INDEX "FeeConfig_product_category_key" ON "FeeConfig"("product", "category");

-- CreateIndex
CREATE UNIQUE INDEX "FxConfig_pair_key" ON "FxConfig"("pair");

-- CreateIndex
CREATE INDEX "FxConfig_enabled_idx" ON "FxConfig"("enabled");

-- CreateIndex
CREATE INDEX "FxConfig_fromCurrency_toCurrency_idx" ON "FxConfig"("fromCurrency", "toCurrency");

-- CreateIndex
CREATE INDEX "FxRateSnapshot_pair_expiresAt_idx" ON "FxRateSnapshot"("pair", "expiresAt");

-- CreateIndex
CREATE INDEX "FxRateSnapshot_pair_fetchedAt_idx" ON "FxRateSnapshot"("pair", "fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillSwiftBulkJob_reference_key" ON "BillSwiftBulkJob"("reference");

-- CreateIndex
CREATE INDEX "BillSwiftBulkJob_userId_idx" ON "BillSwiftBulkJob"("userId");

-- CreateIndex
CREATE INDEX "BillSwiftBulkJob_status_idx" ON "BillSwiftBulkJob"("status");

-- CreateIndex
CREATE INDEX "BillSwiftBulkItem_jobId_idx" ON "BillSwiftBulkItem"("jobId");

-- CreateIndex
CREATE INDEX "BillSwiftBulkItem_status_idx" ON "BillSwiftBulkItem"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_transactionId_key" ON "Receipt"("transactionId");

-- CreateIndex
CREATE INDEX "Receipt_userId_idx" ON "Receipt"("userId");

-- CreateIndex
CREATE INDEX "Receipt_createdAt_idx" ON "Receipt"("createdAt");

-- CreateIndex
CREATE INDEX "ProviderConfig_contract_enabled_idx" ON "ProviderConfig"("contract", "enabled");

-- CreateIndex
CREATE INDEX "ProviderConfig_priority_idx" ON "ProviderConfig"("priority");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderConfig_contract_providerName_key" ON "ProviderConfig"("contract", "providerName");

-- CreateIndex
CREATE INDEX "ProviderRoute_contract_enabled_idx" ON "ProviderRoute"("contract", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderRoute_contract_tier_key" ON "ProviderRoute"("contract", "tier");

-- CreateIndex
CREATE INDEX "ProviderHealthCheck_providerConfigId_checkedAt_idx" ON "ProviderHealthCheck"("providerConfigId", "checkedAt");

-- CreateIndex
CREATE INDEX "ProviderCredentialVersion_providerConfigId_idx" ON "ProviderCredentialVersion"("providerConfigId");

-- CreateIndex
CREATE INDEX "ProviderCredentialVersion_createdAt_idx" ON "ProviderCredentialVersion"("createdAt");

-- CreateIndex
CREATE INDEX "WebhookEndpoint_enabled_idx" ON "WebhookEndpoint"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEndpoint_providerName_contract_key" ON "WebhookEndpoint"("providerName", "contract");

-- CreateIndex
CREATE UNIQUE INDEX "KycTierLimit_tier_product_key" ON "KycTierLimit"("tier", "product");

-- CreateIndex
CREATE UNIQUE INDEX "AmlPolicy_name_key" ON "AmlPolicy"("name");

-- CreateIndex
CREATE INDEX "AmlPolicy_active_idx" ON "AmlPolicy"("active");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentProfile_name_key" ON "DeploymentProfile"("name");

-- CreateIndex
CREATE INDEX "ConfigVersion_entityType_entityId_idx" ON "ConfigVersion"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "ConfigVersion_changedBy_idx" ON "ConfigVersion"("changedBy");

-- CreateIndex
CREATE INDEX "ConfigVersion_createdAt_idx" ON "ConfigVersion"("createdAt");

-- CreateIndex
CREATE INDEX "ComplianceCase_userId_status_idx" ON "ComplianceCase"("userId", "status");

-- CreateIndex
CREATE INDEX "ComplianceCase_type_status_idx" ON "ComplianceCase"("type", "status");

-- CreateIndex
CREATE INDEX "SanctionsEntry_name_idx" ON "SanctionsEntry"("name");

-- CreateIndex
CREATE INDEX "SanctionsEntry_listSource_idx" ON "SanctionsEntry"("listSource");

-- CreateIndex
CREATE INDEX "SanctionsEntry_active_idx" ON "SanctionsEntry"("active");

-- CreateIndex
CREATE INDEX "ScreeningResult_userId_idx" ON "ScreeningResult"("userId");

-- CreateIndex
CREATE INDEX "ScreeningResult_riskLevel_idx" ON "ScreeningResult"("riskLevel");

-- CreateIndex
CREATE INDEX "ScreeningResult_screenedAt_idx" ON "ScreeningResult"("screenedAt");

-- CreateIndex
CREATE INDEX "NotificationLog_userId_idx" ON "NotificationLog"("userId");

-- CreateIndex
CREATE INDEX "NotificationLog_status_createdAt_idx" ON "NotificationLog"("status", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationLog_template_createdAt_idx" ON "NotificationLog"("template", "createdAt");

-- CreateIndex
CREATE INDEX "SupportNote_userId_createdAt_idx" ON "SupportNote"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UsernameHistory_userId_idx" ON "UsernameHistory"("userId");

-- CreateIndex
CREATE INDEX "UsernameHistory_username_idx" ON "UsernameHistory"("username");

-- CreateIndex
CREATE INDEX "LoginHistory_userId_createdAt_idx" ON "LoginHistory"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LoginHistory_createdAt_idx" ON "LoginHistory"("createdAt");

-- CreateIndex
CREATE INDEX "RecoveryToken_userId_purpose_idx" ON "RecoveryToken"("userId", "purpose");

-- CreateIndex
CREATE INDEX "RecoveryToken_code_purpose_idx" ON "RecoveryToken"("code", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_referralCode_key" ON "Referral"("referralCode");

-- CreateIndex
CREATE INDEX "Referral_referrerId_idx" ON "Referral"("referrerId");

-- CreateIndex
CREATE INDEX "Referral_referralCode_idx" ON "Referral"("referralCode");

-- CreateIndex
CREATE INDEX "Referral_status_idx" ON "Referral"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCampaign_name_key" ON "ReferralCampaign"("name");

-- CreateIndex
CREATE INDEX "ReferralCampaign_active_idx" ON "ReferralCampaign"("active");

-- CreateIndex
CREATE INDEX "VirtualCard_userId_idx" ON "VirtualCard"("userId");

-- CreateIndex
CREATE INDEX "VirtualCard_status_idx" ON "VirtualCard"("status");

-- CreateIndex
CREATE INDEX "SavingsProduct_userId_idx" ON "SavingsProduct"("userId");

-- CreateIndex
CREATE INDEX "SavingsProduct_type_idx" ON "SavingsProduct"("type");

-- CreateIndex
CREATE INDEX "SavingsProduct_status_idx" ON "SavingsProduct"("status");

-- CreateIndex
CREATE INDEX "SavingsTransaction_savingsProductId_idx" ON "SavingsTransaction"("savingsProductId");

-- CreateIndex
CREATE INDEX "InvestmentProduct_active_idx" ON "InvestmentProduct"("active");

-- CreateIndex
CREATE INDEX "InvestmentProduct_type_idx" ON "InvestmentProduct"("type");

-- CreateIndex
CREATE INDEX "UserInvestment_userId_idx" ON "UserInvestment"("userId");

-- CreateIndex
CREATE INDEX "UserInvestment_status_idx" ON "UserInvestment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceFlag_service_key" ON "ServiceFlag"("service");

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_ticketNumber_key" ON "SupportTicket"("ticketNumber");

-- CreateIndex
CREATE INDEX "SupportTicket_userId_idx" ON "SupportTicket"("userId");

-- CreateIndex
CREATE INDEX "SupportTicket_status_idx" ON "SupportTicket"("status");

-- CreateIndex
CREATE INDEX "SupportTicket_category_priority_idx" ON "SupportTicket"("category", "priority");

-- CreateIndex
CREATE INDEX "SupportTicket_assignedTo_idx" ON "SupportTicket"("assignedTo");

-- CreateIndex
CREATE INDEX "SupportTicket_createdAt_idx" ON "SupportTicket"("createdAt");

-- CreateIndex
CREATE INDEX "SupportTicketMessage_ticketId_createdAt_idx" ON "SupportTicketMessage"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicketAttachment_ticketId_idx" ON "SupportTicketAttachment"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationPreference_userId_key" ON "CommunicationPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "HelpArticle_slug_key" ON "HelpArticle"("slug");

-- CreateIndex
CREATE INDEX "HelpArticle_category_status_idx" ON "HelpArticle"("category", "status");

-- CreateIndex
CREATE INDEX "HelpArticle_slug_idx" ON "HelpArticle"("slug");

-- CreateIndex
CREATE INDEX "RecoveryAttempt_userId_createdAt_idx" ON "RecoveryAttempt"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "RecoveryAttempt_recoveryType_status_idx" ON "RecoveryAttempt"("recoveryType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Voucher_code_key" ON "Voucher"("code");

-- CreateIndex
CREATE INDEX "Voucher_active_endDate_idx" ON "Voucher"("active", "endDate");

-- CreateIndex
CREATE INDEX "Voucher_code_idx" ON "Voucher"("code");

-- CreateIndex
CREATE INDEX "VoucherRedemption_voucherId_userId_idx" ON "VoucherRedemption"("voucherId", "userId");

-- CreateIndex
CREATE INDEX "VoucherRedemption_userId_idx" ON "VoucherRedemption"("userId");

-- CreateIndex
CREATE INDEX "UserReward_userId_status_idx" ON "UserReward"("userId", "status");

-- CreateIndex
CREATE INDEX "UserReward_userId_type_idx" ON "UserReward"("userId", "type");

-- CreateIndex
CREATE INDEX "UserReward_sourceTransactionId_type_idx" ON "UserReward"("sourceTransactionId", "type");

-- CreateIndex
CREATE INDEX "UserReward_userId_type_tier_idx" ON "UserReward"("userId", "type", "tier");

-- CreateIndex
CREATE INDEX "VirtualCardTransaction_cardId_createdAt_idx" ON "VirtualCardTransaction"("cardId", "createdAt");

-- CreateIndex
CREATE INDEX "VirtualCardTransaction_status_idx" ON "VirtualCardTransaction"("status");

-- CreateIndex
CREATE UNIQUE INDEX "VirtualCardControl_cardId_key" ON "VirtualCardControl"("cardId");

-- CreateIndex
CREATE INDEX "AddressVerification_userId_status_idx" ON "AddressVerification"("userId", "status");

-- CreateIndex
CREATE INDEX "AddressVerification_status_idx" ON "AddressVerification"("status");

-- CreateIndex
CREATE INDEX "StatementRequest_userId_createdAt_idx" ON "StatementRequest"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Dispute_disputeNumber_key" ON "Dispute"("disputeNumber");

-- CreateIndex
CREATE INDEX "Dispute_userId_status_idx" ON "Dispute"("userId", "status");

-- CreateIndex
CREATE INDEX "Dispute_status_priority_idx" ON "Dispute"("status", "priority");

-- CreateIndex
CREATE INDEX "Dispute_assignedTo_idx" ON "Dispute"("assignedTo");

-- CreateIndex
CREATE INDEX "Dispute_createdAt_idx" ON "Dispute"("createdAt");

-- CreateIndex
CREATE INDEX "DisputeMessage_disputeId_createdAt_idx" ON "DisputeMessage"("disputeId", "createdAt");

-- CreateIndex
CREATE INDEX "DisputeAttachment_disputeId_idx" ON "DisputeAttachment"("disputeId");

-- CreateIndex
CREATE INDEX "ScheduledPayment_userId_status_idx" ON "ScheduledPayment"("userId", "status");

-- CreateIndex
CREATE INDEX "ScheduledPayment_nextExecutionAt_idx" ON "ScheduledPayment"("nextExecutionAt");

-- CreateIndex
CREATE INDEX "ScheduledPayment_status_nextExecutionAt_idx" ON "ScheduledPayment"("status", "nextExecutionAt");

-- CreateIndex
CREATE INDEX "PaymentTemplate_userId_type_idx" ON "PaymentTemplate"("userId", "type");

-- CreateIndex
CREATE INDEX "PaymentTemplate_userId_isFavorite_idx" ON "PaymentTemplate"("userId", "isFavorite");

-- CreateIndex
CREATE INDEX "InAppNotification_userId_read_createdAt_idx" ON "InAppNotification"("userId", "read", "createdAt");

-- CreateIndex
CREATE INDEX "InAppNotification_userId_type_createdAt_idx" ON "InAppNotification"("userId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "ChatConversation_userId_status_idx" ON "ChatConversation"("userId", "status");

-- CreateIndex
CREATE INDEX "ChatMessage_conversationId_createdAt_idx" ON "ChatMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Device_userId_idx" ON "Device"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Device_userId_fingerprint_key" ON "Device"("userId", "fingerprint");

-- CreateIndex
CREATE INDEX "SecurityEvent_userId_createdAt_idx" ON "SecurityEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityQuestion_userId_idx" ON "SecurityQuestion"("userId");

-- CreateIndex
CREATE INDEX "Testimonial_approved_display_sortOrder_idx" ON "Testimonial"("approved", "display", "sortOrder");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_createdAt_idx" ON "OutboxEvent"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentIntent_userId_status_createdAt_idx" ON "PaymentIntent"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentIntent_idempotencyKey_idx" ON "PaymentIntent"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementQueue_transactionId_key" ON "SettlementQueue"("transactionId");

-- CreateIndex
CREATE INDEX "SettlementQueue_status_nextRetryAt_idx" ON "SettlementQueue"("status", "nextRetryAt");

-- CreateIndex
CREATE UNIQUE INDEX "CronLock_name_key" ON "CronLock"("name");

-- CreateIndex
CREATE INDEX "CurrencyWallet_userId_idx" ON "CurrencyWallet"("userId");

-- CreateIndex
CREATE INDEX "CurrencyWallet_status_idx" ON "CurrencyWallet"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CurrencyWallet_userId_currency_key" ON "CurrencyWallet"("userId", "currency");

-- CreateIndex
CREATE INDEX "InternationalBeneficiary_userId_idx" ON "InternationalBeneficiary"("userId");

-- CreateIndex
CREATE INDEX "InternationalBeneficiary_userId_isFavourite_idx" ON "InternationalBeneficiary"("userId", "isFavourite");

-- CreateIndex
CREATE UNIQUE INDEX "SystemMetric_key_key" ON "SystemMetric"("key");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentFlowLog_reference_key" ON "PaymentFlowLog"("reference");

-- CreateIndex
CREATE INDEX "PaymentFlowLog_userId_createdAt_idx" ON "PaymentFlowLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentFlowLog_contract_status_createdAt_idx" ON "PaymentFlowLog"("contract", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentFlowLog_selectedProvider_status_idx" ON "PaymentFlowLog"("selectedProvider", "status");

-- CreateIndex
CREATE INDEX "PaymentFlowLog_createdAt_idx" ON "PaymentFlowLog"("createdAt");

-- CreateIndex
CREATE INDEX "ProviderCapability_providerName_idx" ON "ProviderCapability"("providerName");

-- CreateIndex
CREATE INDEX "ProviderCapability_capability_idx" ON "ProviderCapability"("capability");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderCapability_providerName_capability_key" ON "ProviderCapability"("providerName", "capability");

-- CreateIndex
CREATE INDEX "PaymentRoutingDecision_contract_createdAt_idx" ON "PaymentRoutingDecision"("contract", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentRoutingDecision_selectedProvider_createdAt_idx" ON "PaymentRoutingDecision"("selectedProvider", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentRoutingDecision_createdAt_idx" ON "PaymentRoutingDecision"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentLink_reference_key" ON "PaymentLink"("reference");

-- CreateIndex
CREATE INDEX "PaymentLink_userId_idx" ON "PaymentLink"("userId");

-- CreateIndex
CREATE INDEX "PaymentLink_reference_idx" ON "PaymentLink"("reference");

-- CreateIndex
CREATE INDEX "PaymentLink_status_idx" ON "PaymentLink"("status");

-- CreateIndex
CREATE INDEX "PaymentLink_createdAt_idx" ON "PaymentLink"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentLinkPayment_reference_key" ON "PaymentLinkPayment"("reference");

-- CreateIndex
CREATE INDEX "PaymentLinkPayment_paymentLinkId_idx" ON "PaymentLinkPayment"("paymentLinkId");

-- CreateIndex
CREATE INDEX "PaymentLinkPayment_reference_idx" ON "PaymentLinkPayment"("reference");

-- CreateIndex
CREATE INDEX "PaymentLinkPayment_status_idx" ON "PaymentLinkPayment"("status");

-- CreateIndex
CREATE INDEX "PaymentLinkPayment_createdAt_idx" ON "PaymentLinkPayment"("createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Passkey" ADD CONSTRAINT "Passkey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrencyLedgerEntry" ADD CONSTRAINT "CurrencyLedgerEntry_currencyWalletId_fkey" FOREIGN KEY ("currencyWalletId") REFERENCES "CurrencyWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VirtualAccount" ADD CONSTRAINT "VirtualAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StripeCustomer" ADD CONSTRAINT "StripeCustomer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycVerification" ADD CONSTRAINT "KycVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Beneficiary" ADD CONSTRAINT "Beneficiary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmlFlag" ADD CONSTRAINT "AmlFlag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillPayment" ADD CONSTRAINT "BillPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AirtimeDataPurchase" ADD CONSTRAINT "AirtimeDataPurchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtpCode" ADD CONSTRAINT "OtpCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureFlagOverride" ADD CONSTRAINT "FeatureFlagOverride_flagId_fkey" FOREIGN KEY ("flagId") REFERENCES "FeatureFlag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillSwiftBulkItem" ADD CONSTRAINT "BillSwiftBulkItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "BillSwiftBulkJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderRoute" ADD CONSTRAINT "ProviderRoute_providerConfigId_fkey" FOREIGN KEY ("providerConfigId") REFERENCES "ProviderConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderHealthCheck" ADD CONSTRAINT "ProviderHealthCheck_providerConfigId_fkey" FOREIGN KEY ("providerConfigId") REFERENCES "ProviderConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderCredentialVersion" ADD CONSTRAINT "ProviderCredentialVersion_providerConfigId_fkey" FOREIGN KEY ("providerConfigId") REFERENCES "ProviderConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningResult" ADD CONSTRAINT "ScreeningResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportNote" ADD CONSTRAINT "SupportNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsernameHistory" ADD CONSTRAINT "UsernameHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginHistory" ADD CONSTRAINT "LoginHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryToken" ADD CONSTRAINT "RecoveryToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VirtualCard" ADD CONSTRAINT "VirtualCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsProduct" ADD CONSTRAINT "SavingsProduct_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsTransaction" ADD CONSTRAINT "SavingsTransaction_savingsProductId_fkey" FOREIGN KEY ("savingsProductId") REFERENCES "SavingsProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserInvestment" ADD CONSTRAINT "UserInvestment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserInvestment" ADD CONSTRAINT "UserInvestment_investmentProductId_fkey" FOREIGN KEY ("investmentProductId") REFERENCES "InvestmentProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicketMessage" ADD CONSTRAINT "SupportTicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicketAttachment" ADD CONSTRAINT "SupportTicketAttachment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationPreference" ADD CONSTRAINT "CommunicationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherRedemption" ADD CONSTRAINT "VoucherRedemption_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserReward" ADD CONSTRAINT "UserReward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserReward" ADD CONSTRAINT "UserReward_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VirtualCardTransaction" ADD CONSTRAINT "VirtualCardTransaction_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "VirtualCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VirtualCardControl" ADD CONSTRAINT "VirtualCardControl_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "VirtualCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddressVerification" ADD CONSTRAINT "AddressVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementRequest" ADD CONSTRAINT "StatementRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeMessage" ADD CONSTRAINT "DisputeMessage_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeAttachment" ADD CONSTRAINT "DisputeAttachment_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledPayment" ADD CONSTRAINT "ScheduledPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTemplate" ADD CONSTRAINT "PaymentTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InAppNotification" ADD CONSTRAINT "InAppNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatConversation" ADD CONSTRAINT "ChatConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityQuestion" ADD CONSTRAINT "SecurityQuestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementQueue" ADD CONSTRAINT "SettlementQueue_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrencyWallet" ADD CONSTRAINT "CurrencyWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternationalBeneficiary" ADD CONSTRAINT "InternationalBeneficiary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentFlowLog" ADD CONSTRAINT "PaymentFlowLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLinkPayment" ADD CONSTRAINT "PaymentLinkPayment_paymentLinkId_fkey" FOREIGN KEY ("paymentLinkId") REFERENCES "PaymentLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

