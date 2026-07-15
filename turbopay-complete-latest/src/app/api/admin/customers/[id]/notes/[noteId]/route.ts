import { db } from "@/lib/db";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { getSessionUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { audit } from "@/lib/turbopay/audit";

/**
 * DELETE /api/admin/customers/[id]/notes/[noteId]
 *  - Only the note author OR an admin (role === "ADMIN") may delete.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  let actor;
  try {
    actor = await requirePermission(Permissions.ADMIN_VIEW);
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }
  const { id, noteId } = await params;

  const note = await db.supportNote.findUnique({ where: { id: noteId } });
  if (!note) return errorJson("Note not found", 404, "NOT_FOUND");
  if (note.userId !== id) return errorJson("Note does not belong to this customer", 409, "MISMATCH");

  const isAuthor = note.authorId === actor.id;
  const isAdmin = actor.role === "ADMIN";
  if (!isAuthor && !isAdmin) {
    return errorJson("Only the author or an admin may delete this note", 403, "FORBIDDEN");
  }

  await db.supportNote.delete({ where: { id: noteId } });

  await audit({
    userId: actor.id,
    action: "SUPPORT_NOTE_DELETED",
    category: "ADMIN",
    severity: "WARN",
    metadata: {
      customerId: id,
      noteId,
      previousAuthorId: note.authorId,
      previousAuthorName: note.authorName,
      deletedBy: actor.id,
      deletedByRole: actor.role,
    },
  });

  return json({ data: { ok: true, noteId } });
}
