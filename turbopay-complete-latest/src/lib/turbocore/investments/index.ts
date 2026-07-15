import { db } from "@/lib/db";
import { debitWallet, creditWallet } from "@/lib/turbopay/ledger";
import { checkDebit } from "@/lib/turbopay/aml";
import { audit } from "@/lib/turbopay/audit";

/**
 * Parse a duration string like "30 days", "90 days", "6 months", "1 year"
 * into a Date object.
 */
function parseDuration(duration: string): Date {
  const now = Date.now();
  const lower = duration.toLowerCase().trim();
  const match = lower.match(/(\d+)\s*(day|month|year)s?/);
  if (!match) return new Date(now + 90 * 86400_000); // fallback: 90 days
  const num = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case "day": return new Date(now + num * 86400_000);
    case "month": return new Date(now + num * 30 * 86400_000);
    case "year": return new Date(now + num * 365 * 86400_000);
    default: return new Date(now + 90 * 86400_000);
  }
}

/**
 * INVESTMENT SERVICE
 * ==================
 *
 * Manages the investment product catalog + user investment positions. Every
 * investment movement is double-entry: the user's wallet is debited and a
 * matching credit is posted to the platform investment pool (a synthetic
 * ledger account) so the ledger always balances. Liquidation is the inverse —
 * the platform pool is debited and the user's wallet is credited (principal +
 * expected return).
 *
 * The platform investment pool is a Wallet row with a fixed id
 * (PLATFORM_INVESTMENT_POOL_WALLET_ID) owned by a system User row. Platform
 * accounts don't track a running balance — balanceAfterKobo on pool entries
 * is always 0 (the pool's `balanceKobo` cache is never incremented).
 */

/** Fixed wallet id for the platform investment pool. */
export const PLATFORM_INVESTMENT_POOL_WALLET_ID = "PLATFORM_INVESTMENT_POOL";
const PLATFORM_INVESTMENT_POOL_USER_ID = "PLATFORM_INVESTMENT_POOL_USER";
const PLATFORM_INVESTMENT_POOL_EMAIL = "platform-investment-pool@turbopay.internal";

/**
 * Ensure the platform investment pool wallet (+ its system user) exist.
 * Idempotent — fast path is a single indexed lookup. Required because
 * LedgerEntry.walletId has a FK to Wallet.id; we cannot insert a pool leg
 * without a real Wallet row.
 */
async function ensurePlatformInvestmentPool(): Promise<void> {
  const existing = await db.wallet.findUnique({
    where: { id: PLATFORM_INVESTMENT_POOL_WALLET_ID },
    select: { id: true },
  });
  if (existing) return;

  // Create the system user (idempotent upsert — tests may run in parallel).
  await db.user.upsert({
    where: { id: PLATFORM_INVESTMENT_POOL_USER_ID },
    create: {
      id: PLATFORM_INVESTMENT_POOL_USER_ID,
      fullName: "Turbopay Investment Pool",
      email: PLATFORM_INVESTMENT_POOL_EMAIL,
      kycTier: 3,
      kycStatus: "VERIFIED",
      status: "ACTIVE",
      role: "USER",
      emailVerified: true,
    },
    update: {},
  });
  await db.wallet.upsert({
    where: { id: PLATFORM_INVESTMENT_POOL_WALLET_ID },
    create: {
      id: PLATFORM_INVESTMENT_POOL_WALLET_ID,
      userId: PLATFORM_INVESTMENT_POOL_USER_ID,
      balanceKobo: 0,
      currency: "NGN",
      status: "ACTIVE",
    },
    update: {},
  });
}

/**
 * Post a CREDIT leg to the platform investment pool. This is the matching
 * credit when a user buys an investment — it balances the user's debit so
 * the ledger stays double-entry consistent. balanceAfterKobo is always 0
 * because platform accounts don't track a running balance.
 */
async function postPlatformCredit(
  amountKobo: number,
  refType: string,
  refId: string | null,
  description: string | null,
): Promise<{ ledgerEntryId: string }> {
  await ensurePlatformInvestmentPool();
  const entry = await db.ledgerEntry.create({
    data: {
      walletId: PLATFORM_INVESTMENT_POOL_WALLET_ID,
      entryType: "CREDIT",
      amountKobo,
      currency: "NGN",
      refType,
      refId,
      balanceAfterKobo: 0, // platform accounts don't track a running balance
      description,
      immutable: true,
    },
  });
  return { ledgerEntryId: entry.id };
}

/**
 * Post a DEBIT leg to the platform investment pool — the matching opposite
 * leg when a user liquidates an investment (the pool returns principal +
 * return to the user).
 */
async function postPlatformDebit(
  amountKobo: number,
  refType: string,
  refId: string | null,
  description: string | null,
): Promise<{ ledgerEntryId: string }> {
  await ensurePlatformInvestmentPool();
  const entry = await db.ledgerEntry.create({
    data: {
      walletId: PLATFORM_INVESTMENT_POOL_WALLET_ID,
      entryType: "DEBIT",
      amountKobo,
      currency: "NGN",
      refType,
      refId,
      balanceAfterKobo: 0, // platform accounts don't track a running balance
      description,
      immutable: true,
    },
  });
  return { ledgerEntryId: entry.id };
}

/** Compute the expected return (in kobo) for a principal + product. */
function computeExpectedReturnKobo(principalKobo: number, expectedReturnBps: number | null | undefined): number {
  if (!expectedReturnBps || expectedReturnBps <= 0) return 0;
  return Math.round((principalKobo * expectedReturnBps) / 10000);
}

export interface PortfolioEntry {
  id: string;
  productId: string;
  productName: string;
  productType: string;
  riskLevel: string;
  principalKobo: number;
  expectedReturnKobo: number;
  currentValueKobo: number; // principal + expectedReturn for ACTIVE; 0 otherwise
  status: string;
  maturityDate: Date | null;
  createdAt: Date;
}

export interface LiquidationResult {
  investmentId: string;
  status: string;
  principalKobo: number;
  returnKobo: number;
  payoutKobo: number;
}

class InvestmentService {
  async listCatalog() {
    return db.investmentProduct.findMany({ where: { active: true }, orderBy: { createdAt: "desc" } });
  }

  async get(productId: string) {
    return db.investmentProduct.findUnique({ where: { id: productId } });
  }

  async invest(userId: string, productId: string, amountKobo: number) {
    const product = await db.investmentProduct.findUnique({ where: { id: productId, active: true } });
    if (!product) throw new Error("Investment product not found");
    if (amountKobo < product.minAmountKobo) throw new Error(`Minimum investment is ₦${product.minAmountKobo / 100}`);
    if (product.maxAmountKobo && amountKobo > product.maxAmountKobo) throw new Error(`Maximum investment is ₦${product.maxAmountKobo / 100}`);

    // AML check before debiting the wallet.
    const [wallet, userFull] = await Promise.all([
      db.wallet.findUnique({ where: { userId } }),
      db.user.findUnique({ where: { id: userId }, select: { kycTier: true } }),
    ]);
    if (!wallet) throw new Error("Wallet not found");
    const amlResult = await checkDebit(userId, wallet.id, amountKobo, (userFull?.kycTier ?? 1) as 1 | 2 | 3);
    if (!amlResult.allowed) {
      throw new Error(amlResult.reason ?? "Transaction blocked by risk engine");
    }

    // Debit the user's wallet (the investment becomes a platform asset).
    const debit = await debitWallet(wallet.id, amountKobo, "INVESTMENT", {
      description: `Investment — ${product.name}`,
      userId,
    });

    // Post the matching CREDIT leg to the platform investment pool so the
    // ledger balances: user debit + pool credit = 0 net.
    await postPlatformCredit(amountKobo, "INVESTMENT", debit.ledgerEntryId, `Investment — ${product.name}`);

    const expectedReturnKobo = computeExpectedReturnKobo(amountKobo, product.expectedReturnBps);
    const investment = await db.userInvestment.create({
      data: {
        userId,
        investmentProductId: productId,
        amountKobo,
        status: "ACTIVE",
        expectedReturnKobo: expectedReturnKobo > 0 ? expectedReturnKobo : null,
        maturityDate: product.duration ? parseDuration(product.duration) : null,
      },
    });
    await audit({
      userId,
      action: "INVESTMENT_MADE",
      category: "WALLET",
      metadata: {
        investmentId: investment.id,
        productId,
        amountKobo,
        expectedReturnKobo,
        poolWalletId: PLATFORM_INVESTMENT_POOL_WALLET_ID,
      },
    });
    return investment;
  }

  /**
   * Liquidate (sell back) an active investment. Returns the principal plus
   * any expected return to the user's wallet. The platform pool is debited
   * to balance the user's credit. Idempotent: a non-ACTIVE investment
   * cannot be liquidated again — calling liquidate() twice on the same
   * investment throws on the second call (no double-pay).
   */
  async liquidate(userId: string, investmentId: string): Promise<LiquidationResult> {
    const investment = await db.userInvestment.findFirst({
      where: { id: investmentId, userId },
      include: { investmentProduct: true },
    });
    if (!investment) throw new Error("Investment not found");

    // Idempotency: a non-ACTIVE investment cannot be liquidated again.
    if (investment.status !== "ACTIVE") {
      throw new Error(`Investment is ${investment.status}; cannot liquidate`);
    }

    const wallet = await db.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new Error("Wallet not found");

    const principalKobo = investment.amountKobo;
    const returnKobo =
      investment.expectedReturnKobo ??
      computeExpectedReturnKobo(principalKobo, investment.investmentProduct.expectedReturnBps);
    const payoutKobo = principalKobo + returnKobo;

    // Debit the platform pool (returns the principal + return to the user).
    await postPlatformDebit(payoutKobo, "INVESTMENT", investment.id, `Liquidation — ${investment.investmentProduct.name}`);

    // Credit the user's wallet.
    await creditWallet(wallet.id, payoutKobo, "INVESTMENT", {
      refId: investment.id,
      description: `Liquidation — ${investment.investmentProduct.name}`,
    });

    // Mark the investment as LIQUIDATED.
    await db.userInvestment.update({
      where: { id: investmentId },
      data: { status: "LIQUIDATED" },
    });

    await audit({
      userId,
      action: "INVESTMENT_LIQUIDATED",
      category: "WALLET",
      metadata: {
        investmentId,
        productId: investment.investmentProductId,
        principalKobo,
        returnKobo,
        payoutKobo,
        poolWalletId: PLATFORM_INVESTMENT_POOL_WALLET_ID,
      },
    });

    return {
      investmentId,
      status: "LIQUIDATED",
      principalKobo,
      returnKobo,
      payoutKobo,
    };
  }

  /** List the user's investments with current value (principal + expected return). */
  async getPortfolio(userId: string): Promise<PortfolioEntry[]> {
    const investments = await db.userInvestment.findMany({
      where: { userId },
      include: { investmentProduct: true },
      orderBy: { createdAt: "desc" },
    });
    return investments.map((inv) => {
      const principalKobo = inv.amountKobo;
      const expectedReturnKobo =
        inv.expectedReturnKobo ?? computeExpectedReturnKobo(principalKobo, inv.investmentProduct.expectedReturnBps);
      return {
        id: inv.id,
        productId: inv.investmentProductId,
        productName: inv.investmentProduct.name,
        productType: inv.investmentProduct.type,
        riskLevel: inv.investmentProduct.riskLevel,
        principalKobo,
        expectedReturnKobo,
        currentValueKobo: inv.status === "ACTIVE" ? principalKobo + expectedReturnKobo : 0,
        status: inv.status,
        maturityDate: inv.maturityDate,
        createdAt: inv.createdAt,
      };
    });
  }

  async listUserInvestments(userId: string) {
    return db.userInvestment.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: { investmentProduct: true },
    });
  }

  async getUserInvestment(investmentId: string, userId: string) {
    return db.userInvestment.findFirst({
      where: { id: investmentId, userId },
      include: { investmentProduct: true },
    });
  }

  // Admin: create investment product
  async createProduct(input: {
    name: string;
    description?: string;
    type: string;
    provider?: string;
    minAmountKobo: number;
    maxAmountKobo?: number;
    expectedReturnBps?: number;
    duration?: string;
    riskLevel?: string;
  }) {
    return db.investmentProduct.create({ data: { ...input, riskLevel: input.riskLevel ?? "LOW", active: true } });
  }
}

export const investments = new InvestmentService();
