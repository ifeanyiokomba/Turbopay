/**
 * Configure Resend Email Provider
 * ================================
 *
 * Run this script to configure Resend for email notifications.
 *
 * Usage: npx tsx scripts/configure-resend.ts
 *
 * Environment variables needed:
 * - DATABASE_URL: Your PostgreSQL connection string
 * - TURBOPAY_PII_KEY: Your encryption key
 */

import { config } from "dotenv";
import path from "path";
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

// Load .env.local first, then .env as fallback
config({ path: path.resolve(__dirname, "../.env.local") });
config({ path: path.resolve(__dirname, "../.env") });

const prisma = new PrismaClient();

// Resend credentials from environment variables
const RESEND_CONFIG = {
  apiKey: process.env.RESEND_API_KEY || "",
  baseUrl: "https://api.resend.com",
  fromEmail: process.env.RESEND_FROM_EMAIL || "TurboPay <noreply@turbopay.okomba.com>",
};

function encryptPii(data: string): string {
  const key = process.env.TURBOPAY_PII_KEY;
  if (!key) throw new Error("TURBOPAY_PII_KEY environment variable is required");

  // Handle hex-encoded keys (64 hex chars = 32 bytes) or raw strings
  const keyBuffer = key.length === 64
    ? Buffer.from(key, "hex")
    : Buffer.from(key, "utf-8");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBuffer, iv);

  let encrypted = cipher.update(data, "utf-8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

async function configureResend() {
  console.log("📧 Configuring Resend email provider...\n");

  try {
    // Check if Resend already exists
    const existing = await prisma.providerConfig.findFirst({
      where: {
        providerName: "resend",
        contract: "notification",
      },
    });

    const credentialsEnc = encryptPii(JSON.stringify(RESEND_CONFIG));
    const credentialKeys = JSON.stringify(Object.keys(RESEND_CONFIG));

    if (existing) {
      // Update existing
      await prisma.providerConfig.update({
        where: { id: existing.id },
        data: {
          credentialsEnc,
          credentialKeys,
          mode: "production",
          enabled: true,
          displayName: "Resend Email",
        },
      });
      console.log("✅ Updated Resend configuration");
      console.log(`   ID: ${existing.id}`);
    } else {
      // Create new
      const created = await prisma.providerConfig.create({
        data: {
          contract: "notification",
          providerName: "resend",
          displayName: "Resend Email",
          mode: "production",
          credentialsEnc,
          credentialKeys,
          enabled: true,
        },
      });
      console.log("✅ Created Resend configuration");
      console.log(`   ID: ${created.id}`);
    }

    console.log("\n📋 Configuration:");
    console.log(`   API Key: ${RESEND_CONFIG.apiKey.substring(0, 10)}...`);
    console.log(`   From Email: ${RESEND_CONFIG.fromEmail}`);
    console.log(`   Base URL: ${RESEND_CONFIG.baseUrl}`);
    console.log("\n🎉 Resend is now configured for email notifications!");

  } catch (error) {
    console.error("❌ Failed to configure Resend:", error);
  } finally {
    await prisma.$disconnect();
  }
}

configureResend();
