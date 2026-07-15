/**
 * Turbopay Service Layer — CardService.
 * ======================================
 *
 * Wraps the virtual-cards operations exposed by `enhancedCards`.
 * Each method preserves the exact behavior of its source route.
 * The `pin` parameter on fund/withdraw is accepted for forward
 * compatibility (the routes currently don't verify a PIN for card operations;
 * this service preserves that behavior — no PIN verification is performed).
 *
 * Extracted from:
 *   - src/app/api/virtual-cards/route.ts                  → create
 *   - src/app/api/virtual-cards/[id]/fund/route.ts        → fund
 *   - src/app/api/virtual-cards/[id]/withdraw/route.ts    → withdraw
 *   - src/app/api/virtual-cards/[id]/freeze/route.ts      → freeze
 *   - src/app/api/virtual-cards/[id]/unfreeze/route.ts    → unfreeze
 *   - src/app/api/virtual-cards/[id]/terminate/route.ts   → terminate
 */

import { enhancedCards } from "@/lib/turbocore/virtual-cards/enhanced";
import { notify } from "@/lib/turbocore/notifications";
import { ServiceError } from "./types";
import type {
  CreateCardInput,
  FundCardInput,
  WithdrawCardInput,
  CardActionInput,
} from "./types";

class CardService {
  async create(input: CreateCardInput) {
    const card = await enhancedCards.createCard(input.user.id, {
      type: input.type,
      spendingLimitKobo: input.spendingLimitKobo,
    });
    return card;
  }

  async fund(input: FundCardInput) {
    const { user, cardId, amountKobo } = input;
    const result = await enhancedCards.fundCard(cardId, user.id, amountKobo);
    notify
      .sendInApp({
        userId: user.id,
        type: "TRANSACTION",
        title: "Card Funded",
        message: `₦${(amountKobo / 100).toLocaleString()} added to card · New balance: ₦${(result.newCardBalanceKobo / 100).toLocaleString()}`,
        actionUrl: "/cards",
        actionLabel: "View card",
      })
      .catch(() => null);
    return result;
  }

  async withdraw(input: WithdrawCardInput) {
    const { user, cardId, amountKobo } = input;
    const result = await enhancedCards.withdrawFromCard(cardId, user.id, amountKobo);
    notify
      .sendInApp({
        userId: user.id,
        type: "TRANSACTION",
        title: "Card Withdrawal",
        message: `₦${(amountKobo / 100).toLocaleString()} withdrawn from card to wallet`,
        actionUrl: "/cards",
        actionLabel: "View card",
      })
      .catch(() => null);
    return result;
  }

  async freeze(input: CardActionInput) {
    const { user, cardId } = input;
    await enhancedCards.freezeCard(cardId, user.id);
    notify
      .sendInApp({
        userId: user.id,
        type: "SECURITY",
        title: "Card Frozen",
        message: `Your virtual card has been frozen. No new transactions will be authorized until you unfreeze it.`,
        actionUrl: "/cards",
        actionLabel: "View card",
      })
      .catch(() => null);
    return { ok: true as const };
  }

  async unfreeze(input: CardActionInput) {
    const { user, cardId } = input;
    await enhancedCards.unfreezeCard(cardId, user.id);
    notify
      .sendInApp({
        userId: user.id,
        type: "SECURITY",
        title: "Card Unfrozen",
        message: `Your virtual card is now active and ready to use.`,
        actionUrl: "/cards",
        actionLabel: "View card",
      })
      .catch(() => null);
    return { ok: true as const };
  }

  async terminate(input: CardActionInput) {
    const { user, cardId } = input;
    await enhancedCards.terminateCard(cardId, user.id);
    notify
      .sendInApp({
        userId: user.id,
        type: "SECURITY",
        title: "Card Terminated",
        message: `Your virtual card has been terminated and can no longer be used for transactions.`,
        priority: "HIGH",
        actionUrl: "/cards",
        actionLabel: "View cards",
      })
      .catch(() => null);
    return { ok: true as const };
  }
}

export const cardService = new CardService();
