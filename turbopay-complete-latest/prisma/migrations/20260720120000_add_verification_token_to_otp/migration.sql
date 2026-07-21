-- AlterTable: Add verificationToken column to OtpCode table
ALTER TABLE "OtpCode" ADD COLUMN "verificationToken" TEXT;

-- CreateIndex: Unique index on verificationToken for fast lookup
CREATE UNIQUE INDEX "OtpCode_verificationToken_key" ON "OtpCode"("verificationToken");

-- CreateIndex: Additional index for query performance
CREATE INDEX "OtpCode_verificationToken_idx" ON "OtpCode"("verificationToken");
