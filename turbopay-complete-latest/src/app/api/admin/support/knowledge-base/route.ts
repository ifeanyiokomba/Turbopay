import { knowledgeBase, KB_CATEGORIES } from "@/lib/turbocore/knowledge-base";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { getSessionUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

export async function GET() {
  try { await requirePermission(Permissions.ADMIN_VIEW); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  return json({ data: await knowledgeBase.listAll() });
}

const schema = z.object({
  title: z.string().min(3), slug: z.string().min(3), content: z.string().min(10),
  category: z.enum(KB_CATEGORIES as any), tags: z.array(z.string()).optional(),
});

export async function POST(req: Request) {
  try { await requirePermission(Permissions.ADMIN_MANAGE_FLAGS); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const user = await getSessionUser();
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  const article = await knowledgeBase.create({ ...parsed.data, authorId: user?.id, authorName: user?.fullName });
  return json({ data: article }, 201);
}
