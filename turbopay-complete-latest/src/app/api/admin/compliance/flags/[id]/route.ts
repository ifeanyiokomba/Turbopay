import { db } from "@/lib/db";
import { requirePermission, Permissions } from "@/lib/turbocore/rbac";
import { getSessionUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { audit } from "@/lib/turbopay/audit";
import { z } from "zod";

/**
 * ADMIN — resolve / escalate / mark false-positive an AML flag.
 * Permission: AML_RESOLVE (write).
 *
 * Actions:
 *  - resolve         → resolved=true, resolvedAt=now, store notes in metadata
 *  - escalate        → bump severity one level (LOW→MEDIUM→HIGH), store notes
 *  - false_positive  → resolved=true, metadata.resolution="FALSE_POSITIVE"
 */
const schema = z.object({
  action: z.enum(["resolve", "escalate", "false_positive"]),
  notes: z.string().min(2).max(2000),
});

const SEVERITY_ORDER: Record<string, string> = {
  LOW: "MEDIUM",
  MEDIUM: "HIGH",
  HIGH: "HIGH", // already at the top
};

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requirePermission(Permissions.AML_RESOLVE);
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
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorJson(parsed.error.issues[0]?.message ?? "Invalid", 422, "VALIDATION");
  }
  const { action, notes } = parsed.data;

  const flag = await db.amlFlag.findUnique({ where: { id } });
  if (!flag) return errorJson("AML flag not found", 404, "NOT_FOUND");

  const previous = {
    status: flag.resolved ? "RESOLVED" : "OPEN",
    severity: flag.severity,
    metadata: flag.metadata ? JSON.parse(flag.metadata) : null,
  };

  // Build the new metadata envelope so we keep a tidy audit trail.
  const newMeta: Record<string, unknown> = {
    ...(flag.metadata ? JSON.parse(flag.metadata) : {}),
    resolutionNotes: notes,
    resolvedBy: { id: actor.id, name: actor.fullName },
    resolvedAt: new Date().toISOString(),
  };

  const data: any = { metadata: JSON.stringify(newMeta) };
  if (action === "resolve" || action === "false_positive") {
    data.resolved = true;
    data.resolvedAt = new Date();
    newMeta.resolution = action === "false_positive" ? "FALSE_POSITIVE" : "RESOLVED";
    data.metadata = JSON.stringify(newMeta);
  } else if (action === "escalate") {
    data.severity = SEVERITY_ORDER[flag.severity] ?? flag.severity;
    newMeta.escalatedFrom = flag.severity;
    newMeta.escalatedTo = data.severity;
    data.metadata = JSON.stringify(newMeta);
  }

  const updated = await db.amlFlag.update({ where: { id }, data });

  await audit({
    userId: actor.id,
    action: `AML_FLAG_${action.toUpperCase()}`,
    category: "AML",
    severity: action === "escalate" ? "WARN" : "INFO",
    metadata: {
      flagId: id,
      userId: flag.userId,
      rule: flag.rule,
      action,
      notes,
      previous,
      newSeverity: updated.severity,
      newResolved: updated.resolved,
      actorId: actor.id,
      actorName: actor.fullName,
    },
  });

  return json({
    data: {
      id: updated.id,
      rule: updated.rule,
      severity: updated.severity,
      resolved: updated.resolved,
      resolvedAt: updated.resolvedAt?.toISOString() ?? null,
      action,
      metadata: JSON.parse(updated.metadata ?? "{}"),
    },
  });
}
