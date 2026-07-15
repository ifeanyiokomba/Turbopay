import { db } from "@/lib/db";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";
import { audit } from "@/lib/turbopay/audit";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  role: z.string().min(2).optional(),
  location: z.string().optional(),
  quote: z.string().min(10).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  avatarUrl: z.string().url().optional().or(z.literal("")).optional(),
  approved: z.boolean().optional(),
  display: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

/** PATCH /api/admin/testimonials/[id] — update a testimonial (approve, hide, edit). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requirePermission(Permissions.ADMIN_VIEW); } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }
  const { id } = await params;
  let body;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");

  const updated = await db.testimonial.update({
    where: { id },
    data: parsed.data,
  });
  await audit({ userId: actor.id, action: "TESTIMONIAL_UPDATED", category: "ADMIN", metadata: { id, changes: parsed.data } });
  return json({ data: updated });
}

/** DELETE /api/admin/testimonials/[id] — permanently delete a testimonial. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requirePermission(Permissions.ADMIN_VIEW); } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }
  const { id } = await params;
  await db.testimonial.delete({ where: { id } });
  await audit({ userId: actor.id, action: "TESTIMONIAL_DELETED", category: "ADMIN", metadata: { id } });
  return json({ data: { ok: true } });
}
