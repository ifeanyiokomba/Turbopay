import { db } from "@/lib/db";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { getSessionUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { audit } from "@/lib/turbopay/audit";
import { maskPhone, maskEmail } from "@/lib/turbopay/mask";
import { z } from "zod";

/**
 * /api/admin/customers/[id]/notes
 *  - GET  : list support notes for a customer (newest first).
 *  - POST : create a support note. ADMIN_VIEW holders (any admin role) may add.
 */
const createSchema = z.object({
  note: z.string().min(1).max(5000),
  pinned: z.boolean().optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission(Permissions.ADMIN_VIEW);
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }
  const { id } = await params;

  const customer = await db.user.findUnique({ where: { id }, select: { id: true } });
  if (!customer) return errorJson("Customer not found", 404, "NOT_FOUND");

  const notes = await db.supportNote.findMany({
    where: { userId: id },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
  });

  return json({
    data: {
      items: notes.map((n) => ({
        id: n.id,
        authorId: n.authorId,
        authorName: n.authorName,
        note: n.note,
        pinned: n.pinned,
        createdAt: n.createdAt.toISOString(),
        updatedAt: n.updatedAt.toISOString(),
      })),
      total: notes.length,
    },
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requirePermission(Permissions.ADMIN_VIEW);
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }
  const { id } = await params;

  let body;
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid body", 400);
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  }

  const customer = await db.user.findUnique({
    where: { id },
    select: { id: true, email: true, phone: true },
  });
  if (!customer) return errorJson("Customer not found", 404, "NOT_FOUND");

  const created = await db.supportNote.create({
    data: {
      userId: id,
      authorId: actor.id,
      authorName: actor.fullName,
      note: parsed.data.note,
      pinned: parsed.data.pinned ?? false,
    },
  });

  await audit({
    userId: actor.id,
    action: "SUPPORT_NOTE_CREATED",
    category: "ADMIN",
    severity: "INFO",
    metadata: {
      customerId: id,
      customerEmailMasked: maskEmail(customer.email),
      customerPhoneMasked: customer.phone ? maskPhone(customer.phone) : null,
      noteId: created.id,
      pinned: parsed.data.pinned ?? false,
    },
  });

  return json(
    {
      data: {
        id: created.id,
        authorId: created.authorId,
        authorName: created.authorName,
        note: created.note,
        pinned: created.pinned,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      },
    },
    201
  );
}
