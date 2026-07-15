import { db } from "@/lib/db";

class PaymentTemplateService {
  async list(userId: string) { return db.paymentTemplate.findMany({ where: { userId }, orderBy: [{ isFavorite: "desc" }, { lastUsedAt: "desc" }] }); }
  async get(id: string, userId: string) { return db.paymentTemplate.findFirst({ where: { id, userId } }); }

  async create(userId: string, input: { name: string; type: string; recipient?: string; recipientName?: string; bankName?: string; bankCode?: string; productCode?: string; productName?: string; customerRef?: string; meterType?: string; defaultAmountKobo?: number; description?: string; isFavorite?: boolean }) {
    return db.paymentTemplate.create({ data: { userId, ...input } });
  }

  async update(id: string, userId: string, data: Record<string, unknown>) {
    return db.paymentTemplate.updateMany({ where: { id, userId }, data });
  }

  async delete(id: string, userId: string) {
    await db.paymentTemplate.deleteMany({ where: { id, userId } });
    return { ok: true };
  }

  async toggleFavorite(id: string, userId: string) {
    const t = await db.paymentTemplate.findFirst({ where: { id, userId } });
    if (!t) throw new Error("Template not found");
    return db.paymentTemplate.update({ where: { id }, data: { isFavorite: !t.isFavorite } });
  }

  async markUsed(id: string) {
    return db.paymentTemplate.update({ where: { id }, data: { lastUsedAt: new Date() } });
  }
}

export const paymentTemplates = new PaymentTemplateService();
