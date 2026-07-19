-- Migration: Add Mobile Money tables
-- Supports MTN MoMo, Airtel Money, M-Pesa, and Paga

-- Mobile Money Transaction table
CREATE TABLE IF NOT EXISTS "MobileMoneyTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "providerRef" TEXT,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MobileMoneyTransaction_pkey" PRIMARY KEY ("id")
);

-- Create indexes for Mobile Money Transaction
CREATE INDEX IF NOT EXISTS "MobileMoneyTransaction_userId_idx" ON "MobileMoneyTransaction"("userId");
CREATE INDEX IF NOT EXISTS "MobileMoneyTransaction_provider_idx" ON "MobileMoneyTransaction"("provider");
CREATE INDEX IF NOT EXISTS "MobileMoneyTransaction_status_idx" ON "MobileMoneyTransaction"("status");
CREATE INDEX IF NOT EXISTS "MobileMoneyTransaction_reference_idx" ON "MobileMoneyTransaction"("reference");
CREATE INDEX IF NOT EXISTS "MobileMoneyTransaction_createdAt_idx" ON "MobileMoneyTransaction"("createdAt");

-- Add foreign key constraint
ALTER TABLE "MobileMoneyTransaction" ADD CONSTRAINT "MobileMoneyTransaction_userId_fkey" 
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
