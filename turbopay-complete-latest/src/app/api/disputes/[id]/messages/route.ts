import { requireUser } from "@/lib/turbopay/auth";
import { disputes } from "@/lib/turbocore/disputes";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

const schema = z.object({ message: z.string().min(1).max(5000) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const { id } = await params;
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson("Invalid", 422, "VALIDATION");
  const msg = await disputes.addMessage(id, { authorId: user.id, authorName: user.fullName, authorRole: "CUSTOMER", message: parsed.data.message });
  return json({ data: msg }, 201);
}
