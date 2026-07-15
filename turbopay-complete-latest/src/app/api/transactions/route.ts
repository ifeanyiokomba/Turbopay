import { db } from "@/lib/db";
import { requireUser } from "@/lib/turbopay/auth";
import { toTxView } from "@/lib/turbopay/wallet";
import { errorJson, json } from "@/lib/turbopay/api";

export async function GET(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type"); // comma list
  const status = searchParams.get("status");
  const direction = searchParams.get("direction");
  const q = searchParams.get("q")?.trim();
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 200);
  const offset = Math.max(parseInt(searchParams.get("offset") ?? "0", 10) || 0, 0);

  const where: any = { userId: user.id };
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

  return json({ data: { items: items.map(toTxView), total, limit, offset } });
}
