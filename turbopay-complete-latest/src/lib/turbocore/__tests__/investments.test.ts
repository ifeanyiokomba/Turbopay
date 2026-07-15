import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/turbopay/crypto";
import { ensureWallet } from "@/lib/turbopay/wallet";
import { creditWallet } from "@/lib/turbopay/ledger";
import { nairaToKobo } from "@/lib/turbopay/money";
import {
  investments,
  PLATFORM_INVESTMENT_POOL_WALLET_ID,
} from "@/lib/turbocore/investments";

/**
 * Investment ledger integrity tests — verify the double-entry invariant:
 * every investment movement posts matching user + platform-pool legs so the
 * ledger balances (debit + credit = 0 net).
 *
 * Invariants under test:
 *  1. invest() debits the user wallet AND credits the platform pool.
 *  2. liquidate() debits the platform pool AND credits the user wallet
 *     (principal + expected return).
 *  3. Idempotency: liquidating twice does not double-pay (2nd call throws).
 */

let testUserId: string;
let testWalletId: string;
let testProductId: string;

beforeAll(async () => {
  const user = await db.user.create({
    data: {
      fullName: "Invest Test User",
      email: "invest-test@turbopay.test",
      phone: "+2347007777001",
      passwordHash: hashPassword("testpassword123"),
      kycTier: 3,
      kycStatus: "VERIFIED",
      emailVerified: true,
      phoneVerified: true,
    },
  });
  testUserId = user.id;
  const { wallet } = await ensureWallet(user.id, "Invest Test - Turbopay");
  testWalletId = wallet.id;

  // Create a test product with a 10% expected return (1000 bps).
  const product = await investments.createProduct({
    name: "Test Fixed Income",
    description: "Test product",
    type: "FIXED_INCOME",
    minAmountKobo: nairaToKobo(1000),
    maxAmountKobo: nairaToKobo(1_000_000),
    expectedReturnBps: 1000, // 10%
    duration: "90 days",
    riskLevel: "LOW",
  });
  testProductId = product.id;
});

afterAll(async () => {
  // Clean up: delete test data, but NEVER delete the platform pool wallet
  // (it's a system account shared across tests + production code paths).
  await db.ledgerEntry.deleteMany({ where: { walletId: testWalletId } });
  await db.transaction.deleteMany({ where: { walletId: testWalletId } });
  await db.userInvestment.deleteMany({ where: { userId: testUserId } });
  await db.wallet.deleteMany({ where: { id: testWalletId } });
  await db.investmentProduct.deleteMany({ where: { id: testProductId } });
  await db.user.deleteMany({ where: { id: testUserId } });
  await db.$disconnect();
});

beforeEach(async () => {
  // Reset the wallet + clear the user's ledger entries between tests.
  // Also clear the pool's INVESTMENT legs so each test starts from a clean
  // ledger slice (the pool wallet itself is shared + persistent across tests).
  await db.userInvestment.deleteMany({ where: { userId: testUserId } });
  await db.ledgerEntry.deleteMany({ where: { walletId: testWalletId } });
  await db.ledgerEntry.deleteMany({
    where: { walletId: PLATFORM_INVESTMENT_POOL_WALLET_ID, refType: "INVESTMENT" },
  });
  await db.transaction.deleteMany({ where: { walletId: testWalletId } });
  await db.wallet.update({ where: { id: testWalletId }, data: { balanceKobo: 0, status: "ACTIVE" } });
});

describe("Investment ledger integrity", () => {
  it("invest() debits the user wallet AND credits the platform pool (ledger balances)", async () => {
    // Fund the user's wallet first.
    const principal = nairaToKobo(5000);
    await creditWallet(testWalletId, principal, "FUNDING", { description: "test fund" });

    const investment = await investments.invest(testUserId, testProductId, principal);
    expect(investment.status).toBe("ACTIVE");
    expect(investment.amountKobo).toBe(principal);

    // User wallet should be debited by the principal.
    const wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(wallet!.balanceKobo).toBe(0);

    // Platform pool should have a matching CREDIT leg.
    const poolCredit = await db.ledgerEntry.findFirst({
      where: {
        walletId: PLATFORM_INVESTMENT_POOL_WALLET_ID,
        entryType: "CREDIT",
        refType: "INVESTMENT",
        amountKobo: principal,
      },
    });
    expect(poolCredit).not.toBeNull();
    expect(poolCredit!.balanceAfterKobo).toBe(0); // platform accounts don't track running balance

    // User wallet should have a matching DEBIT leg.
    const userDebit = await db.ledgerEntry.findFirst({
      where: {
        walletId: testWalletId,
        entryType: "DEBIT",
        refType: "INVESTMENT",
        amountKobo: principal,
      },
    });
    expect(userDebit).not.toBeNull();

    // Ledger invariant (for INVESTMENT entries only — funding credits come
    // from outside the system so they have no matching debit):
    //   invest debit on user  +  invest credit on pool  =>  balances.
    const [poolInvCredits, poolInvDebits, userInvCredits, userInvDebits] = await Promise.all([
      db.ledgerEntry.aggregate({
        where: { walletId: PLATFORM_INVESTMENT_POOL_WALLET_ID, entryType: "CREDIT", refType: "INVESTMENT" },
        _sum: { amountKobo: true },
      }),
      db.ledgerEntry.aggregate({
        where: { walletId: PLATFORM_INVESTMENT_POOL_WALLET_ID, entryType: "DEBIT", refType: "INVESTMENT" },
        _sum: { amountKobo: true },
      }),
      db.ledgerEntry.aggregate({
        where: { walletId: testWalletId, entryType: "CREDIT", refType: "INVESTMENT" },
        _sum: { amountKobo: true },
      }),
      db.ledgerEntry.aggregate({
        where: { walletId: testWalletId, entryType: "DEBIT", refType: "INVESTMENT" },
        _sum: { amountKobo: true },
      }),
    ]);

    const invCredits = (poolInvCredits._sum.amountKobo ?? 0) + (userInvCredits._sum.amountKobo ?? 0);
    const invDebits = (poolInvDebits._sum.amountKobo ?? 0) + (userInvDebits._sum.amountKobo ?? 0);
    expect(invCredits).toBe(invDebits); // investment ledger balances
    expect(invCredits).toBe(principal);
    expect(invDebits).toBe(principal);
  });

  it("liquidate() credits the user wallet AND debits the platform pool (principal + return)", async () => {
    const principal = nairaToKobo(10000);
    await creditWallet(testWalletId, principal, "FUNDING", { description: "test fund" });

    const investment = await investments.invest(testUserId, testProductId, principal);
    const result = await investments.liquidate(testUserId, investment.id);

    // Expected return = principal * 1000 / 10000 = 10% of principal.
    const expectedReturn = principal / 10;
    const expectedPayout = principal + expectedReturn;
    expect(result.principalKobo).toBe(principal);
    expect(result.returnKobo).toBe(expectedReturn);
    expect(result.payoutKobo).toBe(expectedPayout);
    expect(result.status).toBe("LIQUIDATED");

    // User wallet should now hold the payout (started at 0 after invest).
    const wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(wallet!.balanceKobo).toBe(expectedPayout);

    // Platform pool should have a matching DEBIT leg for the payout.
    const poolDebit = await db.ledgerEntry.findFirst({
      where: {
        walletId: PLATFORM_INVESTMENT_POOL_WALLET_ID,
        entryType: "DEBIT",
        refType: "INVESTMENT",
        amountKobo: expectedPayout,
      },
    });
    expect(poolDebit).not.toBeNull();

    // User wallet should have a matching CREDIT leg for the payout.
    const userCredit = await db.ledgerEntry.findFirst({
      where: {
        walletId: testWalletId,
        entryType: "CREDIT",
        refType: "INVESTMENT",
        amountKobo: expectedPayout,
      },
    });
    expect(userCredit).not.toBeNull();

    // Ledger invariant (for INVESTMENT entries only):
    //   invest debit on user (principal)
    //   invest credit on pool (principal)
    //   liquidate debit on pool (payout)
    //   liquidate credit on user (payout)
    //   => investCredits (pool principal + user payout) == investDebits (user principal + pool payout)
    const [poolInvCredits, poolInvDebits, userInvCredits, userInvDebits] = await Promise.all([
      db.ledgerEntry.aggregate({
        where: { walletId: PLATFORM_INVESTMENT_POOL_WALLET_ID, entryType: "CREDIT", refType: "INVESTMENT" },
        _sum: { amountKobo: true },
      }),
      db.ledgerEntry.aggregate({
        where: { walletId: PLATFORM_INVESTMENT_POOL_WALLET_ID, entryType: "DEBIT", refType: "INVESTMENT" },
        _sum: { amountKobo: true },
      }),
      db.ledgerEntry.aggregate({
        where: { walletId: testWalletId, entryType: "CREDIT", refType: "INVESTMENT" },
        _sum: { amountKobo: true },
      }),
      db.ledgerEntry.aggregate({
        where: { walletId: testWalletId, entryType: "DEBIT", refType: "INVESTMENT" },
        _sum: { amountKobo: true },
      }),
    ]);

    const invCredits = (poolInvCredits._sum.amountKobo ?? 0) + (userInvCredits._sum.amountKobo ?? 0);
    const invDebits = (poolInvDebits._sum.amountKobo ?? 0) + (userInvDebits._sum.amountKobo ?? 0);
    // pool credit = principal, user credit = payout  => credits = principal + payout
    // user debit  = principal, pool debit  = payout  => debits  = principal + payout
    expect(invCredits).toBe(principal + expectedPayout);
    expect(invDebits).toBe(principal + expectedPayout);
    expect(invCredits).toBe(invDebits); // investment ledger still balances
  });

  it("liquidating twice does not double-pay (idempotency)", async () => {
    const principal = nairaToKobo(5000);
    await creditWallet(testWalletId, principal, "FUNDING", { description: "test fund" });

    const investment = await investments.invest(testUserId, testProductId, principal);
    const firstLiquidation = await investments.liquidate(testUserId, investment.id);
    expect(firstLiquidation.payoutKobo).toBe(principal + principal / 10);

    // Second liquidation must throw — the investment is already LIQUIDATED.
    await expect(investments.liquidate(testUserId, investment.id)).rejects.toThrow(
      /Investment is LIQUIDATED; cannot liquidate/,
    );

    // The user's balance must equal exactly one payout (no double-pay).
    const wallet = await db.wallet.findUnique({ where: { id: testWalletId } });
    expect(wallet!.balanceKobo).toBe(firstLiquidation.payoutKobo);

    // And the investment's status is still LIQUIDATED (not double-processed).
    const refreshed = await db.userInvestment.findUnique({ where: { id: investment.id } });
    expect(refreshed!.status).toBe("LIQUIDATED");
  });

  it("getPortfolio() returns the user's active + liquidated investments with current value", async () => {
    const principal = nairaToKobo(3000);
    await creditWallet(testWalletId, principal, "FUNDING", { description: "test fund" });
    const investment = await investments.invest(testUserId, testProductId, principal);

    const portfolio = await investments.getPortfolio(testUserId);
    expect(portfolio.length).toBe(1);
    expect(portfolio[0].id).toBe(investment.id);
    expect(portfolio[0].principalKobo).toBe(principal);
    expect(portfolio[0].expectedReturnKobo).toBe(principal / 10);
    expect(portfolio[0].currentValueKobo).toBe(principal + principal / 10);
    expect(portfolio[0].status).toBe("ACTIVE");

    // After liquidation, currentValue drops to 0.
    await investments.liquidate(testUserId, investment.id);
    const portfolioAfter = await investments.getPortfolio(testUserId);
    expect(portfolioAfter[0].status).toBe("LIQUIDATED");
    expect(portfolioAfter[0].currentValueKobo).toBe(0);
  });
});
