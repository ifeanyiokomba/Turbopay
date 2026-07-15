import { requireUser } from "@/lib/turbopay/auth";
import { support } from "@/lib/turbocore/support";
import { errorJson, json } from "@/lib/turbopay/api";
import { z } from "zod";

const schema = z.object({ message: z.string().min(1).max(5000), isInternal: z.boolean().default(false) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const { id } = await params;
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  // isInternal only for staff
  const isInternal = parsed.data.isInternal && user.role !== "USER";
  const msg = await support.addMessage(id, { authorId: user.id, authorName: user.fullName, authorRole: user.role === "USER" ? "CUSTOMER" : "AGENT", message: parsed.data.message, isInternal });
  return json({ data: msg }, 201);
}
