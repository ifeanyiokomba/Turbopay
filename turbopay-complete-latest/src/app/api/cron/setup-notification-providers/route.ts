/**
 * One-time Setup: Notification Providers
 * ========================================
 *
 * GET /api/cron/setup-notification-providers?secret=xxx
 *
 * This endpoint configures notification providers in the production database.
 * It should be called ONCE to set up Resend and Termii.
 *
 * Security: Requires CRON_SECRET for authentication.
 *
 * After configuration, this endpoint can be deleted or disabled.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { encryptPii } from "@/lib/turbopay/crypto";

export async function GET(req: NextRequest) {
  // Authenticate with cron secret
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Array<{ provider: string; status: string; id?: string; error?: string }> = [];

  // Configure Resend (Email)
  try {
    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      results.push({ provider: "resend", status: "skipped", error: "RESEND_API_KEY not set" });
    } else {
      const existing = await db.providerConfig.findFirst({
        where: { providerName: "resend", contract: "notification" },
      });

      const credentials = {
        apiKey: resendApiKey,
        baseUrl: "https://api.resend.com",
        fromEmail: process.env.RESEND_FROM_EMAIL || "TurboPay <noreply@turbopay.okomba.com>",
      };

      const credentialsEnc = encryptPii(JSON.stringify(credentials));
      const credentialKeys = JSON.stringify(Object.keys(credentials));

      if (existing) {
        await db.providerConfig.update({
          where: { id: existing.id },
          data: {
            credentialsEnc,
            credentialKeys,
            mode: "production",
            enabled: true,
            displayName: "Resend Email",
          },
        });
        results.push({ provider: "resend", status: "updated", id: existing.id });
      } else {
        const created = await db.providerConfig.create({
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
        results.push({ provider: "resend", status: "created", id: created.id });
      }
    }
  } catch (e: any) {
    results.push({ provider: "resend", status: "error", error: e.message });
  }

  // Configure Termii (SMS) - if API key is available
  try {
    const termiiApiKey = process.env.TERMII_API_KEY;
    if (!termiiApiKey) {
      results.push({ provider: "termii", status: "skipped", error: "TERMII_API_KEY not set" });
    } else {
      const existing = await db.providerConfig.findFirst({
        where: { providerName: "termii", contract: "notification" },
      });

      const credentials = {
        apiKey: termiiApiKey,
        senderId: process.env.TERMII_SENDER_ID || "TurboPay",
        baseUrl: "https://api.termii.com",
      };

      const credentialsEnc = encryptPii(JSON.stringify(credentials));
      const credentialKeys = JSON.stringify(Object.keys(credentials));

      if (existing) {
        await db.providerConfig.update({
          where: { id: existing.id },
          data: {
            credentialsEnc,
            credentialKeys,
            mode: "production",
            enabled: true,
            displayName: "Termii SMS",
          },
        });
        results.push({ provider: "termii", status: "updated", id: existing.id });
      } else {
        const created = await db.providerConfig.create({
          data: {
            contract: "notification",
            providerName: "termii",
            displayName: "Termii SMS",
            mode: "production",
            credentialsEnc,
            credentialKeys,
            enabled: true,
          },
        });
        results.push({ provider: "termii", status: "created", id: created.id });
      }
    }
  } catch (e: any) {
    results.push({ provider: "termii", status: "error", error: e.message });
  }

  return NextResponse.json({
    success: true,
    message: "Notification providers configured",
    results,
    timestamp: new Date().toISOString(),
  });
}
