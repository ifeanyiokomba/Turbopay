/**
 * Enhanced Virtual Card Service
 * ==============================
 *
 * Fund / withdraw / controls for prepaid virtual cards. Each card is an
 * external sub-ledger — the wallet leg runs through the double-entry ledger
 * (source of truth), the card leg is a single-entry balance mutation tracked
 * by VirtualCardTransaction rows.
 *
 * Bug fixes (audit §J / §K / §II):
 *  - FEE: the fee category was "VIRTUAL_CARD_FUNDING" but the seed config
 *    uses "VIRTUAL_CARD" — fixed to match so the ₦1,000 flat fee is applied.
 *  - WITHDRAWAL RACE: raw `decrement` with no conditional guard could push
 *    the balance negative under concurrent withdrawals. Now uses a
 *    conditional updateMany with `balanceKobo: { gte: amountKobo }` and
 *    checks the affected-rows count.
 *  - TERMINATE: previously stranded any remaining balance (a TERMINATED card
 *    couldn't be withdrawn from). Now auto-withdraws the full balance back
 *    to the wallet before terminating.
 *
 * Security hardening:
 *  - AML checkDebit() on fund operations (catches frozen wallets + AML flags).
 *  - KYC tier cap enforcement on fund operations.
 *  - Card creation now calls the TurbopayCardIssuer adapter to generate a
 *    Luhn-valid PAN + CVV + expiry, encrypted at rest via encryptPii().
 */
import { db } from "@/lib/db";
import { audit } from "@/lib/turbopay/audit";
import { generateReference } from "@/lib/turbopay/reference";
import { fees } from "@/lib/turbocore/fees";
import { debitWallet, creditWallet } from "@/lib/turbopay/ledger";
import { checkDebit } from "@/lib/turbopay/aml";
import { encryptPii, decryptPii } from "@/lib/turbopay/crypto";
import { KYC_LIMITS } from "@/lib/turbopay/types";
import type { KycTier } from "@/lib/turbopay/types";
import { TurbopayCardIssuer, luhnValid } from "@/lib/turbocore/providers/adapters/turbopay-cards";
import crypto from "node:crypto";

/**
 * PCI DSS 3.2: CVV/CVC must never be stored after authorization — not even
 * encrypted. For simulated cards, we derive a deterministic 3-digit CVV from
 * the PAN using HMAC. Real adapters (Stripe Issuing) don't return CVV at all;
 * the CVV field is absent from their response, and this function handles that.
 */
function deriveCvv(pan: string): string {
  const key = process.env.TURBOPAY_PII_KEY;
  if (!key || key.length < 16) {
    throw new Error("TURBOPAY_PII_KEY must be set (>= 16 chars) to derive CVVs.");
  }
  const hmac = crypto.createHmac("sha256", key).update(pan).digest();
  return (hmac.readUInt16BE(0) % 900 + 100).toString();
}

const cardIssuer = new TurbopayCardIssuer();

/** View returned to the client — never includes the encrypted PAN/CVV. */
export interface CardView {
  id: string;
  userId: string;
  provider: string;
  providerCardId: string | null;
  last4: string | null;
  brand: string | null;
  type: string;
  status: string;
  balanceKobo: number;
  currency: string;
  spendingLimitKobo: number | null;
  cardholderName: string | null;
  expiryMonth: number | null;
  expiryYear: number | null;
  hasCredentials: boolean; // panEnc + cvvEnc exist (for the "reveal" button)
  createdAt: string;
  updatedAt: string;
}

class EnhancedCardService {
  // ─── Create ───────────────────────────────────────────────
  async createCard(
    userId: string,
    opts?: { type?: string; spendingLimitKobo?: number; brand?: "VISA" | "MASTERCARD"; cardholderName?: string },
  ) {
    // Load user for cardholder name + KYC tier.
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true, kycTier: true },
    });
    if (!user) throw new Error("User not found");

    const cardholderName =
      opts?.cardholderName ?? (user.fullName || "TURBOPAY USER");
    const brand = opts?.brand ?? "VISA";
    const type = opts?.type ?? "VIRTUAL";

    // Issue the card via the adapter (generates Luhn-valid PAN + CVV + expiry).
    const issued = await cardIssuer.issueCard({
      cardholderName,
      type: type as "VIRTUAL" | "PHYSICAL",
      brand,
      currency: "NGN",
      spendingLimitMinor: opts?.spendingLimitKobo,
    });
    if (!issued.ok || !issued.data) throw new Error("Card issuer failed to issue card");

    // Sanity: verify the PAN passes Luhn before storing (defence-in-depth).
    if (!luhnValid(issued.data.pan)) throw new Error("Generated PAN failed Luhn validation");

    // Encrypt the PAN at rest (AES-256-GCM). CVV is NEVER stored —
    // PCI DSS Requirement 3.2 prohibits retaining sensitive authentication
    // data after authorization, even encrypted.
    const panEnc = encryptPii(issued.data.pan);

    const card = await db.virtualCard.create({
      data: {
        userId,
        provider: "turbopay",
        providerCardId: issued.data.providerCardId,
        last4: issued.data.last4,
        brand: issued.data.brand,
        type,
        status: "ACTIVE",
        currency: "NGN",
        spendingLimitKobo: opts?.spendingLimitKobo,
        panEnc,
        cvvEnc: null, // Never stored — PCI DSS 3.2
        expiryMonth: issued.data.expiryMonth,
        expiryYear: issued.data.expiryYear,
        cardholderName,
      },
    });

    await audit({
      userId,
      action: "VIRTUAL_CARD_CREATED",
      category: "ADMIN",
      severity: "INFO",
      metadata: { cardId: card.id, last4: issued.data.last4, brand: issued.data.brand },
    });
    return this.toView(card);
  }

  // ─── Fund (wallet → card) ────────────────────────────────
  async fundCard(cardId: string, userId: string, amountKobo: number) {
    const card = await db.virtualCard.findFirst({
      where: { id: cardId, userId, status: "ACTIVE" },
      select: { id: true, balanceKobo: true, spendingLimitKobo: true },
    });
    if (!card) throw new Error("Card not found or not active");

    const wallet = await db.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new Error("Wallet not found");
    if (wallet.status !== "ACTIVE") throw new Error("Wallet is frozen — cannot fund card");
    if (wallet.balanceKobo < amountKobo) throw new Error("Insufficient wallet balance");

    // Spending limit check (monthly cap on card balance).
    if (card.spendingLimitKobo && card.balanceKobo + amountKobo > card.spendingLimitKobo) {
      throw new Error(
        `Funding would exceed the card's spending limit (₦${(card.spendingLimitKobo / 100).toLocaleString()}).`,
      );
    }

    // FIX §J: fee category was "VIRTUAL_CARD_FUNDING" but the seed config uses
    // "VIRTUAL_CARD" — changed to match so the ₦1,000 flat fee is actually applied.
    const feeResult = await fees.calculate("turbopay", "VIRTUAL_CARD", amountKobo);
    const totalDebit = amountKobo + feeResult.feeMinor;

    // AML + KYC tier enforcement on the total debit (amount + fee).
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { kycTier: true },
    });
    const kycTier = (user?.kycTier ?? 1) as KycTier;
    const aml = await checkDebit(userId, wallet.id, totalDebit, kycTier);
    if (!aml.allowed) throw new Error(aml.reason);

    // Debit the wallet through the LEDGER (source of truth). Posts an
    // immutable LedgerEntry with refType=VIRTUAL_CARD_FUND atomically with
    // the conditional balance update — no read-modify-write window.
    const cardRef = generateReference("CARD");
    const debit = await debitWallet(wallet.id, totalDebit, "VIRTUAL_CARD_FUND", {
      refId: cardRef,
      description: `Virtual card funding — card ${cardId}`,
      userId,
    });

    // Credit the card balance (cards are an external/prepaid sub-ledger).
    const updatedCard = await db.virtualCard.update({
      where: { id: cardId },
      data: { balanceKobo: { increment: amountKobo } },
    });

    await db.virtualCardTransaction.create({
      data: {
        cardId,
        type: "FUNDING",
        amountKobo,
        currency: "NGN",
        status: "SUCCESS",
        providerRef: cardRef,
        metadata: JSON.stringify({ fee: feeResult.feeMinor, ledgerEntryId: debit.ledgerEntryId }),
      },
    });
    if (feeResult.feeMinor > 0) {
      await db.virtualCardTransaction.create({
        data: {
          cardId,
          type: "FEE",
          amountKobo: feeResult.feeMinor,
          currency: "NGN",
          status: "SUCCESS",
          merchant: "Card Funding Fee",
        },
      });
    }
    await audit({
      userId,
      action: "CARD_FUNDED",
      category: "WALLET",
      metadata: { cardId, amountKobo, fee: feeResult.feeMinor, ledgerEntryId: debit.ledgerEntryId },
    });
    return { ok: true, newCardBalanceKobo: updatedCard.balanceKobo };
  }

  // ─── Withdraw (card → wallet) ────────────────────────────
  async withdrawFromCard(cardId: string, userId: string, amountKobo: number) {
    const card = await db.virtualCard.findFirst({
      where: { id: cardId, userId, status: "ACTIVE" },
      select: { id: true, balanceKobo: true },
    });
    if (!card) throw new Error("Card not found or not active");
    if (card.balanceKobo < amountKobo) throw new Error("Insufficient card balance");

    const wallet = await db.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new Error("Wallet not found");

    // FIX §K: use a conditional updateMany with a balance guard so concurrent
    // withdrawals can't push the balance negative. If affected rows === 0,
    // another concurrent withdrawal won the race — reject.
    const result = await db.virtualCard.updateMany({
      where: { id: cardId, balanceKobo: { gte: amountKobo } },
      data: { balanceKobo: { decrement: amountKobo } },
    });
    if (result.count === 0) {
      throw new Error("Insufficient card balance — another transaction may have just completed. Please try again.");
    }

    // Credit the wallet through the LEDGER (source of truth).
    const cardRef = generateReference("CARD");
    const credit = await creditWallet(wallet.id, amountKobo, "VIRTUAL_CARD_WITHDRAW", {
      refId: cardRef,
      description: `Virtual card withdrawal — card ${cardId}`,
    });

    await db.virtualCardTransaction.create({
      data: {
        cardId,
        type: "WITHDRAWAL",
        amountKobo,
        currency: "NGN",
        status: "SUCCESS",
        providerRef: cardRef,
        metadata: JSON.stringify({ ledgerEntryId: credit.ledgerEntryId }),
      },
    });
    await audit({
      userId,
      action: "CARD_WITHDRAWAL",
      category: "WALLET",
      metadata: { cardId, amountKobo, ledgerEntryId: credit.ledgerEntryId },
    });
    return { ok: true };
  }

  // ─── Terminate (with auto-withdraw) ──────────────────────
  async terminateCard(cardId: string, userId: string) {
    const card = await db.virtualCard.findFirst({
      where: { id: cardId, userId },
      select: { id: true, balanceKobo: true, status: true, providerCardId: true },
    });
    if (!card) throw new Error("Card not found");
    if (card.status === "TERMINATED") throw new Error("Card is already terminated");

    // FIX §II: auto-withdraw any remaining balance before terminating so
    // funds are never stranded. The previous implementation set status to
    // TERMINATED but withdrawFromCard required status=ACTIVE, leaving money
    // locked on the card forever.
    if (card.balanceKobo > 0 && card.status === "ACTIVE") {
      await this.withdrawFromCard(cardId, userId, card.balanceKobo);
    }

    // Tell the issuer to terminate the card.
    if (card.providerCardId) {
      await cardIssuer.setCardStatus(card.providerCardId, "TERMINATED");
    }

    await db.virtualCard.update({ where: { id: cardId }, data: { status: "TERMINATED" } });
    await audit({
      userId,
      action: "VIRTUAL_CARD_TERMINATED",
      category: "ADMIN",
      severity: "WARN",
      metadata: { cardId, refundedKobo: card.balanceKobo },
    });
    return { ok: true, refundedKobo: card.balanceKobo };
  }

  // ─── Freeze / Unfreeze ───────────────────────────────────
  async freezeCard(cardId: string, userId: string) {
    const card = await db.virtualCard.findFirst({
      where: { id: cardId, userId, status: "ACTIVE" },
      select: { id: true, providerCardId: true },
    });
    if (!card) throw new Error("Card not found or not active");
    if (card.providerCardId) await cardIssuer.setCardStatus(card.providerCardId, "FROZEN");
    await db.virtualCard.update({ where: { id: cardId }, data: { status: "FROZEN" } });
    await audit({ userId, action: "VIRTUAL_CARD_FROZEN", category: "ADMIN", metadata: { cardId } });
  }

  async unfreezeCard(cardId: string, userId: string) {
    const card = await db.virtualCard.findFirst({
      where: { id: cardId, userId, status: "FROZEN" },
      select: { id: true, providerCardId: true },
    });
    if (!card) throw new Error("Card not found or not frozen");
    if (card.providerCardId) await cardIssuer.setCardStatus(card.providerCardId, "ACTIVE");
    await db.virtualCard.update({ where: { id: cardId }, data: { status: "ACTIVE" } });
    await audit({ userId, action: "VIRTUAL_CARD_UNFROZEN", category: "ADMIN", metadata: { cardId } });
  }

  // ─── Reveal card details (PAN + CVV) ─────────────────────
  /** Decrypts the PAN on-demand, derives CVV from PAN (PCI DSS 3.2 compliant). Always audit-logs the reveal. */
  async revealCardDetails(cardId: string, userId: string) {
    const card = await db.virtualCard.findFirst({
      where: { id: cardId, userId },
      select: { id: true, panEnc: true, expiryMonth: true, expiryYear: true, cardholderName: true, last4: true, brand: true },
    });
    if (!card) throw new Error("Card not found");
    if (!card.panEnc) throw new Error("Card credentials not available");

    await audit({
      userId,
      action: "CARD_DETAILS_REVEALED",
      category: "WALLET",
      severity: "WARN",
      metadata: { cardId, last4: card.last4 },
    });

    const pan = decryptPii(card.panEnc);
    const cvv = deriveCvv(pan);
    return {
      pan,
      cvv,
      expiryMonth: card.expiryMonth,
      expiryYear: card.expiryYear,
      cardholderName: card.cardholderName,
      last4: card.last4,
      brand: card.brand,
    };
  }

  // ─── Transactions ────────────────────────────────────────
  async getTransactions(cardId: string, userId: string, page = 1, limit = 50) {
    const card = await db.virtualCard.findFirst({ where: { id: cardId, userId } });
    if (!card) throw new Error("Card not found");
    const [items, total] = await Promise.all([
      db.virtualCardTransaction.findMany({
        where: { cardId },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: (page - 1) * limit,
      }),
      db.virtualCardTransaction.count({ where: { cardId } }),
    ]);
    return { items, total, page, limit };
  }

  // ─── Controls ────────────────────────────────────────────
  async getControls(cardId: string, userId: string) {
    const card = await db.virtualCard.findFirst({ where: { id: cardId, userId } });
    if (!card) throw new Error("Card not found");
    let controls = await db.virtualCardControl.findUnique({ where: { cardId } });
    if (!controls) {
      controls = await db.virtualCardControl.create({ data: { cardId } });
    }
    return controls;
  }

  async updateControls(
    cardId: string,
    userId: string,
    input: {
      onlinePaymentsEnabled?: boolean;
      internationalEnabled?: boolean;
      atmEnabled?: boolean;
      dailyLimitKobo?: number;
      monthlyLimitKobo?: number;
      merchantCategories?: string;
    },
  ) {
    const card = await db.virtualCard.findFirst({ where: { id: cardId, userId } });
    if (!card) throw new Error("Card not found");
    return db.virtualCardControl.upsert({
      where: { cardId },
      create: { cardId, ...input },
      update: input,
    });
  }

  // ─── List ────────────────────────────────────────────────
  async listCards(userId: string): Promise<CardView[]> {
    const cards = await db.virtualCard.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: { controls: true },
    });
    return cards.map((c) => this.toView(c));
  }

  async getCard(cardId: string, userId: string): Promise<CardView | null> {
    const card = await db.virtualCard.findFirst({ where: { id: cardId, userId } });
    return card ? this.toView(card) : null;
  }

  // ─── Admin: list all cards ───────────────────────────────
  async listAllCards(opts?: { status?: string; page?: number; limit?: number }) {
    const page = opts?.page ?? 1;
    const limit = Math.min(opts?.limit ?? 50, 100);
    const where = opts?.status ? { status: opts.status } : {};
    const [items, total] = await Promise.all([
      db.virtualCard.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: (page - 1) * limit,
        include: { user: { select: { id: true, fullName: true, email: true } } },
      }),
      db.virtualCard.count({ where }),
    ]);
    return { items: items.map((c) => this.toView(c)), total, page, limit };
  }

  // ─── Admin: freeze / terminate any card ──────────────────
  async adminFreeze(cardId: string, actorId: string) {
    const card = await db.virtualCard.findUnique({ where: { id: cardId }, select: { providerCardId: true } });
    if (!card) throw new Error("Card not found");
    if (card.providerCardId) await cardIssuer.setCardStatus(card.providerCardId, "FROZEN");
    await db.virtualCard.update({ where: { id: cardId }, data: { status: "FROZEN" } });
    await audit({ userId: actorId, action: "ADMIN_CARD_FROZEN", category: "ADMIN", severity: "WARN", metadata: { cardId } });
  }

  async adminTerminate(cardId: string, actorId: string) {
    const card = await db.virtualCard.findUnique({ where: { id: cardId }, select: { providerCardId: true, balanceKobo: true, userId: true } });
    if (!card) throw new Error("Card not found");
    // Refund any remaining balance to the cardholder's wallet.
    if (card.balanceKobo > 0) {
      const wallet = await db.wallet.findUnique({ where: { userId: card.userId } });
      if (wallet) {
        await creditWallet(wallet.id, card.balanceKobo, "VIRTUAL_CARD_WITHDRAW", {
          refId: generateReference("CARD"),
          description: `Admin card termination refund — card ${cardId}`,
        });
      }
    }
    if (card.providerCardId) await cardIssuer.setCardStatus(card.providerCardId, "TERMINATED");
    await db.virtualCard.update({ where: { id: cardId }, data: { status: "TERMINATED", balanceKobo: 0 } });
    await audit({ userId: actorId, action: "ADMIN_CARD_TERMINATED", category: "ADMIN", severity: "WARN", metadata: { cardId, refundedKobo: card.balanceKobo } });
    return { ok: true, refundedKobo: card.balanceKobo };
  }

  // ─── View mapper (never exposes panEnc / cvvEnc) ─────────
  private toView(c: any): CardView {
    const view: CardView = {
      id: c.id,
      userId: c.userId,
      provider: c.provider,
      providerCardId: c.providerCardId,
      last4: c.last4,
      brand: c.brand,
      type: c.type,
      status: c.status,
      balanceKobo: c.balanceKobo,
      currency: c.currency,
      spendingLimitKobo: c.spendingLimitKobo,
      cardholderName: c.cardholderName,
      expiryMonth: c.expiryMonth,
      expiryYear: c.expiryYear,
      hasCredentials: !!c.panEnc,
      createdAt: c.createdAt?.toISOString?.() ?? c.createdAt,
      updatedAt: c.updatedAt?.toISOString?.() ?? c.updatedAt,
    };
    // Include the nested user object when it was eagerly loaded (admin views).
    if (c.user) {
      (view as any).user = c.user;
    }
    return view;
  }
}

export const enhancedCards = new EnhancedCardService();
