import { requireUser } from "@/lib/turbopay/auth";
import { paymentTemplates } from "@/lib/turbocore/templates";
import { errorJson, json } from "@/lib/turbopay/api";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const { id } = await params;
  return json({ data: await paymentTemplates.delete(id, user.id) });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  if (searchParams.get("action") === "favorite") return json({ data: await paymentTemplates.toggleFavorite(id, user.id) });
  let body; try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  return json({ data: await paymentTemplates.update(id, user.id, body) });
}
