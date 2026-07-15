import { knowledgeBase } from "@/lib/turbocore/knowledge-base";
import { errorJson, json } from "@/lib/turbopay/api";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = await knowledgeBase.get(slug);
  if (!article || article.status !== "PUBLISHED") return errorJson("Article not found", 404);
  return json({ data: article });
}
