import { db } from "@/lib/db";
import { requireUser } from "@/lib/turbopay/auth";
import { getWalletView, toTxView } from "@/lib/turbopay/wallet";
import { errorJson, json } from "@/lib/turbopay/api";
import { koboToNaira } from "@/lib/turbopay/money";
import type { TxType } from "@/lib/turbopay/types";

export async function GET() {
  let user;
  try {
    user = await requireUser();
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }
  const wallet = await getWalletView(user.id);
  if (!wallet) return errorJson("Wallet not found", 404);

  // Use SQL aggregation instead of loading rows into JS memory. This scales
  // to users with tens of thousands of transactions without OOM.
  const since14 = new Date(Date.now() - 14 * 86400_000);
  const since30 = new Date(Date.now() - 30 * 86400_000);

  // 30-day totals (money in / out) + transaction count.
  const [inAgg, outAgg, txCount] = await Promise.all([
    db.transaction.aggregate({
      where: { userId: user.id, status: "SUCCESS", direction: "CREDIT", createdAt: { gte: since30 } },
      _sum: { amountKobo: true },
    }),
    db.transaction.aggregate({
      where: { userId: user.id, status: "SUCCESS", direction: "DEBIT", createdAt: { gte: since30 } },
      _sum: { amountKobo: true },
    }),
    db.transaction.count({ where: { userId: user.id } }),
  ]);
  const totalIn = inAgg._sum.amountKobo ?? 0;
  const totalOut = outAgg._sum.amountKobo ?? 0;

  // Category breakdown (last 30 days, debits) via groupBy.
  const categoryGroups = await db.transaction.groupBy({
    by: ["type"],
    where: { userId: user.id, status: "SUCCESS", direction: "DEBIT", createdAt: { gte: since30 } },
    _sum: { amountKobo: true },
  });
  const categories = categoryGroups
    .map((g) => ({ name: friendlyCategory(g.type as TxType), kobo: g._sum.amountKobo ?? 0, naira: koboToNaira(g._sum.amountKobo ?? 0) }))
    .filter((c) => c.kobo > 0)
    .sort((a, b) => b.kobo - a.kobo);

  // 14-day in/out series — aggregate per day. We fetch the per-day buckets
  // with a single grouped query and shape them in JS (SQLite has no
  // DATE_TRUNC, but Prisma groupBy on a computed field isn't supported; we
  // instead fetch the 14-day debits/credits and bucket in JS — bounded to 14
  // days so the row count is small).
  const recentTxs = await db.transaction.findMany({
    where: { userId: user.id, status: "SUCCESS", createdAt: { gte: since14 } },
    select: { direction: true, amountKobo: true, createdAt: true },
  });
  const dayMs = 86400_000;
  const days: { date: string; label: string; inKobo: number; outKobo: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const start = new Date(Date.now() - i * dayMs);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + dayMs);
    const dayTx = recentTxs.filter((t) => t.createdAt >= start && t.createdAt < end);
    days.push({
      date: start.toISOString().slice(0, 10),
      label: start.toLocaleDateString("en-NG", { month: "short", day: "numeric" }),
      inKobo: dayTx.filter((t) => t.direction === "CREDIT").reduce((a, t) => a + t.amountKobo, 0),
      outKobo: dayTx.filter((t) => t.direction === "DEBIT").reduce((a, t) => a + t.amountKobo, 0),
    });
  }

  const recent = await db.transaction.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 6,
  });

  const kycRecord = await db.kycVerification.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  // Multi-currency wallets summary
  const currencyWallets = await db.currencyWallet.findMany({
    where: { userId: user.id, status: { not: "CLOSED" } },
    select: { currency: true, balanceMinor: true, lockedMinor: true, status: true },
    orderBy: { createdAt: "asc" },
  });

  // Total balance in minor units across all currency wallets
  const totalCurrencyBalance = currencyWallets.reduce((sum, w) => sum + w.balanceMinor, 0);

  return json({
    data: {
      wallet,
      stats: { totalInKobo: totalIn, totalOutKobo: totalOut, txCount, netKobo: totalIn - totalOut },
      series: days,
      categories,
      recent: recent.map(toTxView),
      kyc: kycRecord
        ? { tier: kycRecord.tier, status: kycRecord.status, provider: kycRecord.provider }
        : null,
      currencyWallets,
      totalCurrencyBalanceMinor: totalCurrencyBalance,
    },
  });
}

function friendlyCategory(type: TxType): string {
  switch (type) {
    case "AIRTIME": return "Airtime";
    case "DATA": return "Data";
    case "BILL_ELECTRICITY": return "Electricity";
    case "BILL_UTILITY": return "Utilities";
    case "TRANSFER_OUT": return "Transfers";
    case "FEE": return "Fees";
    default: return "Other";
  }
}
