import { knowledgeBase } from "@/lib/turbocore/knowledge-base";
import { json } from "@/lib/turbopay/api";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category") ?? undefined;
  const q = searchParams.get("q");
  if (q) return json({ data: await knowledgeBase.search(q) });
  return json({ data: await knowledgeBase.listPublished(category) });
}
