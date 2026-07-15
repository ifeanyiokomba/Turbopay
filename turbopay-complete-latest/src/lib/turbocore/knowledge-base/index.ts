import { db } from "@/lib/db";

const KB_CATEGORIES = [
  "GETTING_STARTED", "REGISTRATION", "LOGIN", "RECOVERY", "WALLET", "TRANSFERS",
  "BILLS", "KYC", "SAVINGS", "INVESTMENTS", "CARDS", "INTERNATIONAL", "SECURITY", "FAQ",
] as const;

class KnowledgeBaseService {
  async listPublished(category?: string) {
    return db.helpArticle.findMany({
      where: { status: "PUBLISHED", ...(category ? { category } : {}) },
      orderBy: [{ category: "asc" }, { title: "asc" }],
      select: { id: true, title: true, slug: true, category: true, tags: true, views: true, helpfulCount: true },
    });
  }

  async get(slug: string) {
    const article = await db.helpArticle.findUnique({ where: { slug } });
    if (article && article.status === "PUBLISHED") {
      await db.helpArticle.update({ where: { id: article.id }, data: { views: { increment: 1 } } });
    }
    return article;
  }

  async search(query: string) {
    return db.helpArticle.findMany({
      where: { status: "PUBLISHED", OR: [{ title: { contains: query } }, { content: { contains: query } }, { tags: { contains: query } }] },
      take: 20,
      select: { id: true, title: true, slug: true, category: true },
    });
  }

  async markHelpful(id: string) { return db.helpArticle.update({ where: { id }, data: { helpfulCount: { increment: 1 } } }); }
  async markUnhelpful(id: string) { return db.helpArticle.update({ where: { id }, data: { unhelpfulCount: { increment: 1 } } }); }

  // Admin methods
  async listAll() { return db.helpArticle.findMany({ orderBy: [{ category: "asc" }, { title: "asc" }] }); }
  async create(input: { title: string; slug: string; content: string; category: string; tags?: string[]; authorId?: string; authorName?: string }) {
    return db.helpArticle.create({ data: { ...input, tags: input.tags ? JSON.stringify(input.tags) : null } });
  }
  async update(id: string, input: Partial<{ title: string; content: string; category: string; status: string; tags: string }>) {
    const existing = await db.helpArticle.findUnique({ where: { id } });
    return db.helpArticle.update({ where: { id }, data: { ...input, version: (existing?.version ?? 0) + 1 } });
  }
  async delete(id: string) { return db.helpArticle.delete({ where: { id } }); }
}

export const knowledgeBase = new KnowledgeBaseService();
export { KB_CATEGORIES };
