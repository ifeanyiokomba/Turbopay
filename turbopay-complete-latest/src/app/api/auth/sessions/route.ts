import { db } from "@/lib/db";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/turbopay/auth";
import { hashToken } from "@/lib/turbopay/crypto";
import { errorJson, json } from "@/lib/turbopay/api";

export async function GET() {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const sessions = await db.session.findMany({
    where: { userId: user.id, revokedAt: null },
    orderBy: { createdAt: "desc" },
    // tokenHash is required to identify the CURRENT session: the cookie stores
    // the raw token, we sha256 it server-side, and match against the stored hash
    // (see createSession/getSessionUser in src/lib/turbopay/auth.ts). The
    // session `id` is an unrelated cuid and must NOT be used for this comparison.
    select: { id: true, tokenHash: true, ip: true, userAgent: true, deviceInfo: true, createdAt: true, expiresAt: true },
  });
  const c = await cookies();
  const currentToken = c.get("tp_session")?.value;
  const currentHash = currentToken ? hashToken(currentToken) : null;
  // NOTE: tokenHash is deliberately omitted from the response payload — it is
  // a server-side secret and must never be exposed to the client. Only the
  // computed `isCurrent` boolean leaves the server.
  return json({
    data: sessions.map(s => ({
      id: s.id,
      ip: s.ip,
      userAgent: s.userAgent,
      deviceInfo: s.deviceInfo,
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      isCurrent: !!currentHash && s.tokenHash === currentHash,
    })),
  });
}

export async function DELETE(req: Request) {
  let user; try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }
  const { searchParams } = new URL(req.url);
  const all = searchParams.get("all") === "true";
  if (all) {
    const c = await cookies();
    const currentToken = c.get("tp_session")?.value;
    const currentHash = currentToken ? hashToken(currentToken) : null;
    await db.session.updateMany({ where: { userId: user.id, revokedAt: null, NOT: { tokenHash: currentHash ?? "" } }, data: { revokedAt: new Date() } });
    return json({ data: { ok: true, message: "All other sessions terminated" } });
  }
  const sessionId = searchParams.get("id");
  if (!sessionId) return errorJson("Session id or ?all=true required", 400);
  await db.session.updateMany({ where: { id: sessionId, userId: user.id }, data: { revokedAt: new Date() } });
  return json({ data: { ok: true } });
}
