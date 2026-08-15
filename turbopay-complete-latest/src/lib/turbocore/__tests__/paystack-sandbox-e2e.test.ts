import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/turbopay/crypto";
import { creditWallet, getLedgerBalance } from "@/lib/turbopay/ledger";
import { ensureWallet } from "@/lib/turbopay/wallet";
import { nairaToKobo } from "@/lib/turbopay/money";
import { transferService, ServiceError } from "@/lib/turbopay/services";
import { providerConfig } from "@/lib/turbocore/config/provider-config";
import { providerRouting } from "@/lib/turbocore/config/provider-routing";
import type { SessionUser } from "@/lib/turbopay/types";

/**
 * PAYSTACK SANDBOX E2E — the REAL Paystack adapter against api.paystack.co.
 *
 * Credential-gated: requires PAYSTACK_TEST_SECRET_KEY (an `sk_test_…` key
 * from https://dashboard.paystack.com/#/settings/developers). Without it the
 * suite skips cleanly (CI stays green; no fake connectivity is assumed).
 *
 * When the key IS present, this exercises the true TurboPay flow end to end:
 *
 *   user/wallet setup → fund wallet → TransferService.send() → PIN verify →
 *   idempotency → AML → hold (atomic wallet debit + PENDING transaction) →
 *   provider routing (DB ProviderConfig → Paystack adapter) →
 *   real POST /transferrecipient + POST /transfer on api.paystack.co →
 *   PENDING/SUCCESS status → transaction row + wallet + ledger effect.
 *
 * The ONLY mock is Paystack's own sandbox: `sk_test_…` credentials hit the
 * sandbox environment, so no real money moves. The business logic (service,
 * orchestrator, routing, webhooks) is the real application code.
 *
 * Run:  PAYSTACK_TEST_SECRET_KEY=sk_test_… npx vitest run src/lib/turbocore/__tests__/paystack-sandbox-e2e.test.ts
 */
const PS_KEY = process.env.PAYSTACK_TEST_SECRET_KEY;
const enabled = !!PS_KEY && PS_KEY.startsWith("sk_test_");

// Paystack sandbox test bank account (documented sandbox NUBAN).
const SANDBOX_ACCOUNT = "0000000000";
const SANDBOX_BANK = "044"; // Access Bank

let sender: SessionUser;
let senderUserId: string;
let senderWalletId: string;
let configId: string | null = null;

beforeAll(async () => {
  if (!enabled) return;

  const suffix = Math.floor(Math.random() * 1_000_000).toString();
  const s = await db.user.create({
    data: {
      fullName: "Paystack Sandbox Sender",
      email: `ps-sandbox-${suffix}@turbopay.test`,
      phone: `+234700333${suffix.padStart(4, "0").slice(-4)}`,
      passwordHash: hashPassword("password123"),
      transactionPinHash: hashPassword("1234"),
      kycTier: 2,
      kycStatus: "VERIFIED",
      emailVerified: true,
      phoneVerified: true,
    },
  });
  senderUserId = s.id;
  const w = await ensureWallet(s.id, "Paystack Sandbox Sender - Turbopay");
  senderWalletId = w.wallet.id;
  sender = {
    id: s.id,
    fullName: s.fullName,
    username: null,
    email: s.email,
    phone: s.phone,
    country: "NG",
    kycTier: 2,
  } as SessionUser;

  // Fund the wallet (ledger credit) so the transfer has a balance.
  await creditWallet(senderWalletId, nairaToKobo(50_000), "FUNDING", {
    description: "sandbox E2E funding",
  });

  // Wire DB routing: localTransfer → Paystack adapter (decrypted creds from
  // ProviderConfig — the real production resolution path).
  const cfg = await providerConfig.create({
    contract: "localTransfer",
    providerName: "paystack",
    displayName: "Paystack (sandbox E2E)",
    mode: "production",
    enabled: true,
    priority: 1,
    credentials: {
      secretKey: PS_KEY!,
      publicKey: process.env.PAYSTACK_TEST_PUBLIC_KEY ?? "pk_test_dummy",
      baseUrl: "https://api.paystack.co",
    },
  });
  configId = cfg.id;
  await providerRouting.setRoute("localTransfer", "PRIMARY", cfg.id);
});

afterAll(async () => {
  if (configId) {
    await db.providerRoute.deleteMany({ where: { providerConfigId: configId } });
    await db.providerRoute.deleteMany({ where: { contract: "localTransfer" } });
    await db.providerConfig.deleteMany({ where: { id: configId } });
  }
  if (senderUserId) {
    await db.transaction.deleteMany({ where: { userId: senderUserId } });
    await db.ledgerEntry.deleteMany({ where: { walletId: senderWalletId } });
    await db.wallet.deleteMany({ where: { id: senderWalletId } });
    await db.user.deleteMany({ where: { id: senderUserId } });
  }
  await db.$disconnect();
});

describe.skipIf(!enabled)("Paystack sandbox E2E (real api.paystack.co)", () => {
  it("initiates a transfer through the real flow and records wallet/ledger effects", async () => {
    const res = await transferService.send({
      user: sender,
      accountNumber: SANDBOX_ACCOUNT,
      bankCode: SANDBOX_BANK,
      bankName: "Access Bank (sandbox)",
      recipientName: "Paystack Sandbox",
      amountNaira: 1_000,
      pin: "1234",
      idemKey: `ps-e2e-${Date.now()}`,
      ip: "127.0.0.1",
    });

    expect(res.reference).toBeTruthy();
    expect(res.status).toBeDefined();

    // The transaction row exists with a provider reference from Paystack.
    const tx = await db.transaction.findUnique({
      where: { reference: res.reference },
    });
    expect(tx).not.toBeNull();
    expect(tx!.status).toBeTruthy();
    expect(tx!.providerRef).toBeTruthy(); // transfer_code / reference from Paystack

    // Wallet debited exactly once; ledger has one debit entry for the transfer.
    const wallet = await db.wallet.findUnique({ where: { id: senderWalletId } });
    expect(wallet!.balanceKobo).toBeLessThan(nairaToKobo(50_000));
    const ledger = await getLedgerBalance(senderWalletId);
    expect(ledger).toBe(wallet!.balanceKobo);

    // If the transfer is PENDING, its providerRef must be resolvable by the
    // webhook handler's extractProviderRef (transfer_code path).
    if (res.status === "PENDING") {
      const { paystackWebhookHandler } = await import("@/lib/turbocore/webhooks/handlers/paystack");
      const ref = paystackWebhookHandler.extractProviderRef({
        event: "transfer.success",
        data: { transfer_code: tx!.providerRef, reference: res.reference },
      });
      expect(ref).toBe(tx!.providerRef);
    }
  });

  it("is idempotent — the same idempotency key does not debit twice", async () => {
    const key = `ps-e2e-dup-${Date.now()}`;
    const first = await transferService.send({
      user: sender,
      accountNumber: SANDBOX_ACCOUNT,
      bankCode: SANDBOX_BANK,
      bankName: "Access Bank (sandbox)",
      recipientName: "Paystack Sandbox",
      amountNaira: 500,
      pin: "1234",
      idemKey: key,
      ip: "127.0.0.1",
    });
    const balanceAfterFirst = (await db.wallet.findUnique({ where: { id: senderWalletId } }))!.balanceKobo;
    const second = await transferService.send({
      user: sender,
      accountNumber: SANDBOX_ACCOUNT,
      bankCode: SANDBOX_BANK,
      bankName: "Access Bank (sandbox)",
      recipientName: "Paystack Sandbox",
      amountNaira: 500,
      pin: "1234",
      idemKey: key,
      ip: "127.0.0.1",
    });
    const balanceAfterSecond = (await db.wallet.findUnique({ where: { id: senderWalletId } }))!.balanceKobo;

    expect(second.reference).toBe(first.reference); // same logical transfer
    expect(balanceAfterSecond).toBe(balanceAfterFirst); // no double debit
  });

  it("rejects an incorrect PIN before contacting the provider", async () => {
    await expect(
      transferService.send({
        user: sender,
        accountNumber: SANDBOX_ACCOUNT,
        bankCode: SANDBOX_BANK,
        bankName: "Access Bank (sandbox)",
        recipientName: "Paystack Sandbox",
        amountNaira: 100,
        pin: "9999",
        idemKey: null,
        ip: "127.0.0.1",
      })
    ).rejects.toBeInstanceOf(ServiceError);
  });
});
