import { db } from "@/lib/db";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { errorJson, json } from "@/lib/turbopay/api";
import { audit } from "@/lib/turbopay/audit";
import { z } from "zod";

/** GET /api/admin/testimonials — list ALL testimonials (including unapproved/hidden). */
export async function GET() {
  try { await requirePermission(Permissions.ADMIN_VIEW); } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }
  const testimonials = await db.testimonial.findMany({
    orderBy: { createdAt: "desc" },
  });
  return json({ data: testimonials });
}

const createSchema = z.object({
  name: z.string().min(2, "Name is required"),
  role: z.string().min(2, "Role is required"),
  location: z.string().optional(),
  quote: z.string().min(10, "Quote must be at least 10 characters"),
  rating: z.number().int().min(1).max(5).default(5),
  avatarUrl: z.string().url().optional().or(z.literal("")),
  approved: z.boolean().default(false),
  display: z.boolean().default(true),
  sortOrder: z.number().int().default(100),
});

/** POST /api/admin/testimonials — create a new testimonial. */
export async function POST(req: Request) {
  let actor;
  try { actor = await requirePermission(Permissions.ADMIN_VIEW); } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }
  let body;
  try { body = await req.json(); } catch { return errorJson("Invalid body", 400); }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");

  const created = await db.testimonial.create({ data: parsed.data });
  await audit({ userId: actor.id, action: "TESTIMONIAL_CREATED", category: "ADMIN", metadata: { id: created.id, name: created.name } });
  return json({ data: created }, 201);
}
