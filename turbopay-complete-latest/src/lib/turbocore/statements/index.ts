import { db } from "@/lib/db";
import { formatNaira } from "@/lib/turbopay/money";
import { audit } from "@/lib/turbopay/audit";

class StatementService {
  /** Generate a statement for a user (returns JSON data — frontend renders PDF/CSV). */
  async generate(userId: string, input: { fromDate: Date; toDate: Date; format: string; filters?: Record<string, unknown>; emailTo?: string }) {
    const where: Record<string, unknown> = { userId, createdAt: { gte: input.fromDate, lte: input.toDate } };
    if (input.filters?.type) where.type = input.filters.type;
    if (input.filters?.status) where.status = input.filters.status;

    const [transactions, user, wallet] = await Promise.all([
      db.transaction.findMany({ where, orderBy: { createdAt: "asc" } }),
      db.user.findUnique({ where: { id: userId }, select: { fullName: true, email: true, phone: true, username: true } }),
      db.wallet.findUnique({ where: { userId }, select: { balanceKobo: true, currency: true } }),
    ]);

    const totalIn = transactions.filter(t => t.direction === "CREDIT").reduce((a, t) => a + t.amountKobo, 0);
    const totalOut = transactions.filter(t => t.direction === "DEBIT").reduce((a, t) => a + t.amountKobo, 0);

    const statement = {
      user: { fullName: user?.fullName, email: user?.email, phone: user?.phone, username: user?.username },
      wallet: { balanceKobo: wallet?.balanceKobo ?? 0, currency: wallet?.currency ?? "NGN" },
      period: { from: input.fromDate.toISOString(), to: input.toDate.toISOString() },
      summary: { totalInKobo: totalIn, totalOutKobo: totalOut, transactionCount: transactions.length, netKobo: totalIn - totalOut },
      transactions: transactions.map(t => ({
        reference: t.reference, type: t.type, direction: t.direction, amountKobo: t.amountKobo,
        feeKobo: t.feeKobo, status: t.status, description: t.description,
        counterpartyName: t.counterpartyName, provider: t.provider, createdAt: t.createdAt.toISOString(),
      })),
      generatedAt: new Date().toISOString(),
    };

    // Record the statement request
    const request = await db.statementRequest.create({
      data: {
        userId, format: input.format, fromDate: input.fromDate, toDate: input.toDate,
        filters: input.filters ? JSON.stringify(input.filters) : null,
        status: "GENERATED", emailTo: input.emailTo ?? null,
      },
    });

    await audit({ userId, action: "STATEMENT_GENERATED", category: "WALLET", metadata: { requestId: request.id, format: input.format, txCount: transactions.length, emailed: !!input.emailTo } });

    return { requestId: request.id, statement };
  }

  /** Get statement history for a user. */
  async getHistory(userId: string) {
    return db.statementRequest.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 20 });
  }
}

export const statements = new StatementService();
