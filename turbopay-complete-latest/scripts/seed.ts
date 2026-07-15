/**
 * TurboPay — Database Seed Script
 *
 * Seeds the database with essential configuration data:
 *   - KYC tier limits (3 tiers)
 *   - Default AML policy
 *   - Admin user (if ADMIN_EMAIL env var is set)
 *   - Default fee configs (optional)
 *
 * Usage:
 *   bun run seed              # seed everything
 *   bun run seed --admin-only # seed only the admin user
 *
 * Environment variables:
 *   ADMIN_EMAIL     — email for the admin user (optional)
 *   ADMIN_PASSWORD  — password for the admin user (default: "Admin123!")
 *   ADMIN_FULL_NAME — full name for the admin user (default: "Admin")
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function seedKycLimits() {
  console.log("  Seeding KYC tier limits...");
  const tiers = [
    { tier: 1, product: "turbopay", singleTxMinor: 50_000_00, dailyTxMinor: 150_000_00, balanceMinor: 300_000_00, label: "Tier 1 — Starter" },
    { tier: 2, product: "turbopay", singleTxMinor: 500_000_00, dailyTxMinor: 2_000_000_00, balanceMinor: 5_000_000_00, label: "Tier 2 — Verified (NIN)" },
    { tier: 3, product: "turbopay", singleTxMinor: 5_000_000_00, dailyTxMinor: 20_000_000_00, balanceMinor: 2147483647, label: "Tier 3 — Premium (BVN)" },
  ];

  for (const tier of tiers) {
    await db.kycTierLimit.upsert({
      where: { tier_product: { tier: tier.tier, product: tier.product } },
      create: { ...tier, active: true },
      update: { singleTxMinor: tier.singleTxMinor, dailyTxMinor: tier.dailyTxMinor, balanceMinor: tier.balanceMinor, label: tier.label },
    });
  }
  console.log("    ✓ 3 KYC tier limits created/updated");
}

async function seedAmlPolicy() {
  console.log("  Seeding default AML policy...");
  const existing = await db.amlPolicy.findFirst({ where: { name: "default" } });
  if (existing) {
    console.log("    ○ AML policy already exists, skipping");
    return;
  }

  const policy = {
    velocity: { windowMin: 60, maxDebits: 10, severity: "HIGH" as const },
    largeAmount: { thresholdMinor: 1_000_000_00, severity: "MEDIUM" as const },
    rapidTransfer: { windowMin: 5, maxTransfers: 3, severity: "HIGH" as const },
    autoFreezeOnHigh: true,
    strThresholdMinor: 5_000_000_00,
    dailyStrThresholdMinor: 10_000_000_00,
  };

  await db.amlPolicy.create({
    data: {
      name: "default",
      description: "Default AML policy for TurboPay",
      policy: JSON.stringify(policy),
      active: true,
    },
  });
  console.log("    ✓ Default AML policy created");
}

async function seedAdminUser() {
  const email = process.env.ADMIN_EMAIL;
  if (!email) {
    console.log("  Skipping admin user (ADMIN_EMAIL not set)");
    return;
  }

  console.log(`  Seeding admin user: ${email}...`);
  const { hashPassword } = await import("../src/lib/turbopay/crypto");

  const existing = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) {
    if (existing.role !== "ADMIN") {
      await db.user.update({ where: { id: existing.id }, data: { role: "ADMIN" } });
      console.log(`    ✓ Existing user promoted to ADMIN`);
    } else {
      console.log("    ○ Admin user already exists, skipping");
    }
    return;
  }

  const password = process.env.ADMIN_PASSWORD || "Admin123!";
  const fullName = process.env.ADMIN_FULL_NAME || "Admin";

  const user = await db.user.create({
    data: {
      fullName,
      email: email.toLowerCase(),
      passwordHash: hashPassword(password),
      emailVerified: true,
      role: "ADMIN",
      status: "ACTIVE",
      kycTier: 3,
      kycStatus: "VERIFIED",
    },
  });

  // Create wallet for the admin
  await db.wallet.create({
    data: { userId: user.id, balanceKobo: 0, currency: "NGN", status: "ACTIVE" },
  });

  console.log(`    ✓ Admin user created (id: ${user.id})`);
}

async function seedFeeConfigs() {
  console.log("  Seeding default fee configs...");
  const fees = [
    { product: "turbopay", category: "TRANSFER", type: "PERCENT", value: 100, minFeeMinor: 100_00, maxFeeMinor: 2_000_00, currency: "NGN" },
    { product: "turbopay", category: "AIRTIME", type: "FLAT", value: 0, minFeeMinor: 0, maxFeeMinor: null, currency: "NGN" },
    { product: "turbopay", category: "DATA", type: "FLAT", value: 0, minFeeMinor: 0, maxFeeMinor: null, currency: "NGN" },
    { product: "turbopay", category: "BILL_ELECTRICITY", type: "PERCENT", value: 50, minFeeMinor: 50_00, maxFeeMinor: 500_00, currency: "NGN" },
    { product: "turbopay", category: "BILL_UTILITY", type: "PERCENT", value: 50, minFeeMinor: 50_00, maxFeeMinor: 500_00, currency: "NGN" },
  ];

  for (const fee of fees) {
    await db.feeConfig.upsert({
      where: { product_category: { product: fee.product, category: fee.category } },
      create: { ...fee, active: true },
      update: { type: fee.type, value: fee.value, minFeeMinor: fee.minFeeMinor, maxFeeMinor: fee.maxFeeMinor },
    });
  }
  console.log(`    ✓ ${fees.length} fee configs created/updated`);
}

async function main() {
  console.log("\n=== TurboPay Seed ===\n");

  const adminOnly = process.argv.includes("--admin-only");

  if (!adminOnly) {
    await seedKycLimits();
    await seedAmlPolicy();
    await seedFeeConfigs();
  }
  await seedAdminUser();

  console.log("\n=== Seed Complete ===\n");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
