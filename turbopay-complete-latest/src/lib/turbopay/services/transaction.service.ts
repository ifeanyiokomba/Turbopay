/**
 * Turbopay Service Layer — TransactionService.
 * ==============================================
 *
 * Read-side transaction queries (list + receipt). Extracted from:
 *   - src/app/api/transactions/route.ts        → list
 *   - src/app/api/transactions/receipt/route.ts → receipt
 */

import { db } from "@/lib/db";
import { toTxView } from "@/lib/turbopay/wallet";
import { ServiceError } from "./types";

interface ListTransactionsInput {
  userId: string;
  type?: string;
  status?: string;
  direction?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

interface TransactionReceipt {
  receiptId: string;
  reference: string;
  type: string;
  direction: string;
  status: string;
  amount: number;
  fee: number;
  total: number;
  currency: string;
  counterparty: {
    name?: string;
    account?: string;
    bank?: string | null;
  };
  description: string | null;
  provider: string | null | undefined;
  createdAt: string;
  platform: { name: string; tagline: string };
}

class TransactionService {
  /**
   * List user transactions with filtering, search, and pagination.
   */
  async list(input: ListTransactionsInput) {
    const { userId, type, status, direction, q, limit = 50, offset = 0 } = input;

    const where: any = { userId };
    if (type && type !== "ALL") {
      where.type = { in: type.split(",").map((t) => t.trim()).filter(Boolean) };
    }
    if (status && status !== "ALL") where.status = status;
    if (direction && direction !== "ALL") where.direction = direction;
    if (q) {
      where.OR = [
        { reference: { contains: q } },
        { description: { contains: q } },
        { counterpartyName: { contains: q } },
        { counterpartyAccount: { contains: q } },
      ];
    }

    const [total, items] = await Promise.all([
      db.transaction.count({ where }),
      db.transaction.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip: offset }),
    ]);

    return { items: items.map(toTxView), total, limit, offset };
  }

  /**
   * Generate a user-facing transaction receipt with PII masking.
   */
  async receipt(userId: string, txId: string): Promise<TransactionReceipt> {
    const tx = await db.transaction.findFirst({
      where: { id: txId, userId },
    });

    if (!tx) throw new ServiceError("TRANSACTION_NOT_FOUND", "Transaction not found", 404);

    const maskName = (name: string) => {
      if (!name || name.length <= 1) return name;
      return name[0] + "*".repeat(Math.min(name.length - 1, 8));
    };

    return {
      receiptId: `RCP-${tx.reference}`,
      reference: tx.reference,
      type: tx.type,
      direction: tx.direction,
      status: tx.status,
      amount: tx.amountKobo / 100,
      fee: tx.feeKobo / 100,
      total: (tx.amountKobo + tx.feeKobo) / 100,
      currency: "NGN",
      counterparty: {
        name: tx.counterpartyName ? maskName(tx.counterpartyName) : undefined,
        account: tx.counterpartyAccount ? `****${tx.counterpartyAccount.slice(-4)}` : undefined,
        bank: tx.counterpartyBank,
      },
      description: tx.description,
      provider: tx.provider,
      createdAt: tx.createdAt.toISOString(),
      platform: { name: "Turbopay", tagline: "Digital Banking Made Simple" },
    };
  }
}

export const transactionService = new TransactionService();
