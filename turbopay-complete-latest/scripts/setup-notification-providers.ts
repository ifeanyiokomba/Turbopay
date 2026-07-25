/**
 * Setup Notification Providers (Resend + Termii)
 * ================================================
 *
 * This script configures notification providers in the database.
 * Run with: npx tsx scripts/setup-notification-providers.ts
 *
 * Environment variables required:
 * - DATABASE_URL: PostgreSQL connection string
 * - TURBOPAY_PII_KEY: Encryption key for credentials
 * - RESEND_API_KEY: Resend API key (from resend.com)
 * - RESEND_FROM_EMAIL: Sender email (e.g., "TurboPay <noreply@turbopay.ng>")
 * - TERMII_API_KEY: Termii API key (from termii.com)
 * - TERMII_SENDER_ID: Sender name (e.g., "TurboPay")
 */

import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient();

// AES-256-GCM encryption for credentials
function encryptPii(data: string): string {
  const key = process.env.TURBOPAY_PII_KEY;
  if (!key) throw new Error("TURBOPAY_PII_KEY environment variable is required");

  const keyBuffer = Buffer.from(key.length === 64 ? key : key.padEnd(32, "0"), "utf-8");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBuffer, iv);

  let encrypted = cipher.update(data, "utf-8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encryptedData
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

interface ProviderSetup {
  providerName: string;
  displayName: string;
  contract: string;
  credentials: Record<string, string>;
  mode: string;
}

async function setupProviders() {
  console.log("🔧 Setting up notification providers...\n");

  const providers: ProviderSetup[] = [];

  // Resend (Email)
  const resendApiKey = process.env.RESEND_API_KEY;
  const resendFromEmail = process.env.RESEND_FROM_EMAIL;
  if (resendApiKey) {
    providers.push({
      providerName: "resend",
      displayName: "Resend Email",
      contract: "notification",
      credentials: {
        apiKey: resendApiKey,
        baseUrl: "https://api.resend.com",
        fromEmail: resendFromEmail || "TurboPay <noreply@turbopay.okomba.com>",
      },
      mode: "production",
    });
    console.log("✅ Resend configuration found");
  } else {
    console.log("⚠️  RESEND_API_KEY not set — skipping Resend setup");
  }

  // Termii (SMS)
  const termiiApiKey = process.env.TERMII_API_KEY;
  const termiiSenderId = process.env.TERMII_SENDER_ID;
  if (termiiApiKey) {
    providers.push({
      providerName: "termii",
      displayName: "Termii SMS",
      contract: "notification",
      credentials: {
        apiKey: termiiApiKey,
        senderId: termiiSenderId || "TurboPay",
        baseUrl: "https://api.termii.com",
      },
      mode: "production",
    });
    console.log("✅ Termii configuration found");
  } else {
    console.log("⚠️  TERMII_API_KEY not set — skipping Termii setup");
  }

  if (providers.length === 0) {
    console.log("\n❌ No provider API keys found. Please set at least one:");
    console.log("   - RESEND_API_KEY (from https://resend.com/api-keys)");
    console.log("   - TERMII_API_KEY (from https://termii.com/dashboard)");
    process.exit(1);
  }

  console.log(`\n📦 Configuring ${providers.length} provider(s)...\n`);

  for (const provider of providers) {
    try {
      // Check if provider already exists
      const existing = await prisma.providerConfig.findFirst({
        where: {
          providerName: provider.providerName,
          contract: provider.contract,
        },
      });

      const credentialsEnc = encryptPii(JSON.stringify(provider.credentials));
      const credentialKeys = JSON.stringify(Object.keys(provider.credentials));

      if (existing) {
        // Update existing
        await prisma.providerConfig.update({
          where: { id: existing.id },
          data: {
            credentialsEnc,
            credentialKeys,
            mode: provider.mode,
            enabled: true,
            displayName: provider.displayName,
          },
        });
        console.log(`✅ Updated ${provider.displayName} (ID: ${existing.id})`);
      } else {
        // Create new
        const created = await prisma.providerConfig.create({
          data: {
            contract: provider.contract,
            providerName: provider.providerName,
            displayName: provider.displayName,
            mode: provider.mode,
            credentialsEnc,
            credentialKeys,
            enabled: true,
          },
        });
        console.log(`✅ Created ${provider.displayName} (ID: ${created.id})`);
      }
    } catch (error) {
      console.error(`❌ Failed to configure ${provider.displayName}:`, error);
    }
  }

  console.log("\n🎉 Notification providers configured successfully!");
  console.log("\nNext steps:");
  console.log("1. Test OTP delivery by registering a new user");
  console.log("2. Check NotificationLog table for delivery status");
  console.log("3. Monitor /api/admin/notifications for failed deliveries");

  await prisma.$disconnect();
}

setupProviders().catch(console.error);
