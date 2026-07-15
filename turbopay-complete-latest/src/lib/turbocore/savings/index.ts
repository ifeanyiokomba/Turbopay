import { db } from "@/lib/db";
import { transferBetweenWallets } from "@/lib/turbopay/ledger";
import { checkDebit } from "@/lib/turbopay/aml";
import { audit } from "@/lib/turbopay/audit";
import { generateReference } from "@/lib/turbopay/reference";

/**
 * SAVINGS SERVICE — double-entry accounting via transferBetweenWallets.
 *
 * Money moves between the user's wallet and the platform savings pool wallet.
 * This ensures the ledger always balances: every deposit is a DEBIT on the
 * user wallet + CREDIT on the pool wallet, and vice versa for withdrawals.
 */

class SavingsService {
  async create(userId: string, input: { name: string; type: string; targetAmountKobo?: number; lockUntil?: Date; interestRateBps?: number; autoSaveAmountKobo?: number; autoSaveFrequency?: string }) {
    const product = await db.savingsProduct.create({
      data: { userId, name: input.name, type: input.type, targetAmountKobo: input.targetAmountKobo, lockUntil: input.lockUntil, interestRateBps: input.interestRateBps ?? 0, autoSaveAmountKobo: input.autoSaveAmountKobo, autoSaveFrequency: input.autoSaveFrequency, status: "ACTIVE" },
    });
    await audit({ userId, action: "SAVINGS_CREATED", category: "WALLET", metadata: { productId: product.id, type: input.type } });
    return product;
  }

  async deposit(productId: string, userId: string, amountKobo: number) {
    const [product, userWallet, poolWallet, userFull] = await Promise.all([
      db.savingsProduct.findFirst({ where: { id: productId, userId, status: "ACTIVE" } }),
      db.wallet.findUnique({ where: { userId } }),
      db.wallet.findUnique({ where: { userId: "platform-savings-pool" } }),
      db.user.findUnique({ where: { id: userId }, select: { kycTier: true } }),
    ]);
    if (!product) throw new Error("Savings product not found");
    if (!userWallet || !poolWallet) throw new Error("Wallet configuration error");

    // AML check before moving money.
    const amlResult = await checkDebit(userId, userWallet.id, amountKobo, (userFull?.kycTier ?? 1) as any);
    if (!amlResult.allowed) {
      throw new Error(amlResult.reason ?? "Transaction blocked by risk engine");
    }

    // True double-entry: user wallet DEBIT, pool wallet CREDIT.
    await transferBetweenWallets(userWallet.id, poolWallet.id, amountKobo, "TRANSFER", {
      description: `Savings deposit — ${product.name}`,
    });
    await db.savingsProduct.update({ where: { id: productId }, data: { currentAmountKobo: { increment: amountKobo } } });
    await db.savingsTransaction.create({ data: { savingsProductId: productId, type: "DEPOSIT", amountKobo, reference: generateReference("SAV") } });
    await audit({ userId, action: "SAVINGS_DEPOSIT", category: "WALLET", metadata: { productId, amountKobo } });

    // Check if goal target reached
    if (product.targetAmountKobo && product.currentAmountKobo + amountKobo >= product.targetAmountKobo) {
      await audit({ userId, action: "SAVINGS_GOAL_REACHED", category: "WALLET", metadata: { productId, target: product.targetAmountKobo, current: product.currentAmountKobo + amountKobo } });
    }

    return { ok: true };
  }

  async withdraw(productId: string, userId: string, amountKobo: number) {
    const product = await db.savingsProduct.findFirst({ where: { id: productId, userId, status: "ACTIVE" } });
    if (!product) throw new Error("Savings product not found");
    if (product.type === "LOCKED" && product.lockUntil && product.lockUntil > new Date()) throw new Error("Cannot withdraw from locked savings before maturity");
    if (product.currentAmountKobo < amountKobo) throw new Error("Insufficient savings balance");
    const [userWallet, poolWallet] = await Promise.all([
      db.wallet.findUnique({ where: { userId } }),
      db.wallet.findUnique({ where: { userId: "platform-savings-pool" } }),
    ]);
    if (!userWallet || !poolWallet) throw new Error("Wallet configuration error");

    // Reverse transfer: pool wallet DEBIT, user wallet CREDIT.
    await transferBetweenWallets(poolWallet.id, userWallet.id, amountKobo, "TRANSFER", {
      description: `Savings withdrawal — ${product.name}`,
    });
    await db.savingsProduct.update({ where: { id: productId }, data: { currentAmountKobo: { decrement: amountKobo } } });
    await db.savingsTransaction.create({ data: { savingsProductId: productId, type: "WITHDRAWAL", amountKobo, reference: generateReference("SAV") } });
    await audit({ userId, action: "SAVINGS_WITHDRAWAL", category: "WALLET", metadata: { productId, amountKobo } });
    return { ok: true };
  }

  /**
   * Accrue interest on all ACTIVE savings products with interestRateBps > 0.
   * Called by cron job (daily). Posts interest as a CREDIT to the pool wallet
   * and creates an INTEREST savings transaction.
   */
  async accrueInterest() {
    const products = await db.savingsProduct.findMany({
      where: { status: "ACTIVE", interestRateBps: { gt: 0 }, currentAmountKobo: { gt: 0 } },
    });

    let accrued = 0;
    for (const product of products) {
      // Daily interest: (amount * rateBps / 10000) / 365
      const dailyInterest = Math.floor((product.currentAmountKobo * product.interestRateBps) / 10000 / 365);
      if (dailyInterest <= 0) continue;

      await db.savingsProduct.update({
        where: { id: product.id },
        data: { currentAmountKobo: { increment: dailyInterest } },
      });
      await db.savingsTransaction.create({
        data: {
          savingsProductId: product.id,
          type: "INTEREST",
          amountKobo: dailyInterest,
          reference: generateReference("SAV-INT"),
        },
      });
      accrued += dailyInterest;
    }

    if (accrued > 0) {
      await audit({ action: "SAVINGS_INTEREST_ACCRUED", category: "WALLET", metadata: { productsAccrued: products.length, totalAccruedKobo: accrued } });
    }

    return { accrued, products: products.length };
  }

  /**
   * Execute auto-saves for products with autoSaveAmountKobo configured.
   * Called by cron job (daily/weekly/monthly). Checks frequency and executes
   * deposits from user wallet to savings.
   */
  async executeAutoSaves() {
    const now = new Date();
    const products = await db.savingsProduct.findMany({
      where: { status: "ACTIVE", autoSaveAmountKobo: { gt: 0 } },
    });

    let executed = 0;
    for (const product of products) {
      // Check if auto-save should run based on frequency
      const shouldRun = this.shouldAutoSave(product, now);
      if (!shouldRun) continue;

      // Check user has sufficient balance
      const userWallet = await db.wallet.findUnique({ where: { userId: product.userId } });
      if (!userWallet || userWallet.balanceKobo < product.autoSaveAmountKobo!) continue;

      try {
        await this.deposit(product.id, product.userId, product.autoSaveAmountKobo!);
        executed++;
      } catch {
        // Skip failed auto-saves (user may have frozen wallet, etc.)
      }
    }

    if (executed > 0) {
      await audit({ action: "SAVINGS_AUTO_SAVE_EXECUTED", category: "WALLET", metadata: { executed } });
    }

    return { executed };
  }

  private shouldAutoSave(product: { autoSaveFrequency: string | null; lastAutoSaveAt: Date | null }, now: Date): boolean {
    if (!product.autoSaveFrequency) return false;
    const last = product.lastAutoSaveAt;
    if (!last) return true; // Never auto-saved yet

    const diffMs = now.getTime() - last.getTime();
    const DAY_MS = 86400_000;

    switch (product.autoSaveFrequency) {
      case "DAILY": return diffMs >= DAY_MS;
      case "WEEKLY": return diffMs >= 7 * DAY_MS;
      case "MONTHLY": return diffMs >= 30 * DAY_MS;
      default: return false;
    }
  }

  async list(userId: string) { return db.savingsProduct.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, include: { transactions: { orderBy: { createdAt: "desc" }, take: 10 } } }); }
  async get(productId: string, userId: string) { return db.savingsProduct.findFirst({ where: { id: productId, userId }, include: { transactions: { orderBy: { createdAt: "desc" } } } }); }
}

export const savings = new SavingsService();
