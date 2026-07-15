/**
 * Test script for Gmail SMTP email delivery.
 * -----------------------------------------
 * Run: bun run scripts/test-email.ts
 *
 * Environment variables (or pass as args):
 *   SMTP_USER   — Gmail address (e.g. you@gmail.com)
 *   SMTP_PASS   — App Password (16 chars, no spaces)
 *   SMTP_TO     — Recipient email to test (default: same as SMTP_USER)
 *
 * This script tests:
 *   1. Gmail SMTP connection and authentication
 *   2. OTP verification email template
 *   3. Password reset email template
 *   4. Email verification link template
 */

import { GmailSmtpNotificationProvider } from "../src/lib/turbocore/providers/adapters/gmail-smtp";

const SMTP_USER = process.env.SMTP_USER ?? "";
const SMTP_PASS = process.env.SMTP_PASS ?? "";
const SMTP_TO = process.env.SMTP_TO ?? SMTP_USER;

async function main() {
  console.log("=== TurboPay Gmail SMTP Test ===\n");

  if (!SMTP_USER || !SMTP_PASS) {
    console.error("ERROR: Set SMTP_USER and SMTP_PASS environment variables.");
    console.error("");
    console.error("To generate a Gmail App Password:");
    console.error("  1. Go to https://myaccount.google.com/security");
    console.error("  2. Enable 2-Step Verification (required)");
    console.error("  3. Go to https://myaccount.google.com/apppasswords");
    console.error("  4. Generate an app password for 'Mail'");
    console.error("  5. Use that 16-character password");
    console.error("");
    console.error("Usage:");
    console.error("  SMTP_USER=you@gmail.com SMTP_PASS=abcd efgh ijkl mnop bun run scripts/test-email.ts");
    process.exit(1);
  }

  console.log(`Gmail: ${SMTP_USER}`);
  console.log(`Test recipient: ${SMTP_TO}`);
  console.log("");

  const provider = new GmailSmtpNotificationProvider({
    user: SMTP_USER,
    pass: SMTP_PASS.replace(/\s/g, ""), // Remove spaces from app password
    fromName: "Turbopay",
  });

  let passed = 0;
  let failed = 0;

  // Test 1: OTP verification email
  console.log("Test 1: OTP Verification Email");
  try {
    const result = await provider.send({
      to: SMTP_TO,
      channel: "EMAIL",
      template: "auth.otp",
      variables: {
        otp: "123456",
        userName: "Test User",
      },
    });
    if (result.ok) {
      console.log(`  ✅ SENT — messageId: ${result.data?.messageId}`);
      passed++;
    } else {
      console.log(`  ❌ FAILED — ${result.error?.message}`);
      failed++;
    }
  } catch (e) {
    console.log(`  ❌ ERROR — ${e instanceof Error ? e.message : e}`);
    failed++;
  }
  console.log("");

  // Test 2: Email verification with link
  console.log("Test 2: Email Verification (with link)");
  try {
    const result = await provider.send({
      to: SMTP_TO,
      channel: "EMAIL",
      template: "auth.verify-email",
      variables: {
        otp: "654321",
        userName: "New User",
        verifyUrl: "http://localhost:3000/api/auth/verify-email/confirm?otp=654321&target=test@example.com",
      },
    });
    if (result.ok) {
      console.log(`  ✅ SENT — messageId: ${result.data?.messageId}`);
      passed++;
    } else {
      console.log(`  ❌ FAILED — ${result.error?.message}`);
      failed++;
    }
  } catch (e) {
    console.log(`  ❌ ERROR — ${e instanceof Error ? e.message : e}`);
    failed++;
  }
  console.log("");

  // Test 3: Password reset email
  console.log("Test 3: Password Reset Email");
  try {
    const result = await provider.send({
      to: SMTP_TO,
      channel: "EMAIL",
      template: "auth.forgot-password",
      variables: {
        otp: "999999",
        userName: "Test User",
      },
    });
    if (result.ok) {
      console.log(`  ✅ SENT — messageId: ${result.data?.messageId}`);
      passed++;
    } else {
      console.log(`  ❌ FAILED — ${result.error?.message}`);
      failed++;
    }
  } catch (e) {
    console.log(`  ❌ ERROR — ${e instanceof Error ? e.message : e}`);
    failed++;
  }
  console.log("");

  // Test 4: Verify provider name
  console.log("Test 4: Provider Identity");
  if (provider.name === "gmail-smtp") {
    console.log(`  ✅ Provider name: ${provider.name}`);
    passed++;
  } else {
    console.log(`  ❌ Expected 'gmail-smtp', got '${provider.name}'`);
    failed++;
  }
  console.log("");

  // Summary
  console.log("=== Results ===");
  console.log(`Passed: ${passed}/${passed + failed}`);
  if (failed > 0) {
    console.log(`Failed: ${failed}`);
    process.exit(1);
  } else {
    console.log("All tests passed! Check your inbox at " + SMTP_TO);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
