import { db } from "@/lib/db";
import { requireUser, createIframeToken, readIp } from "@/lib/turbopay/auth";
import { audit } from "@/lib/turbopay/audit";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";

/**
 * POST /api/auth/iframe-token
 *
 * Issues a SHORT-LIVED (5-minute) bearer token for cross-site iframe contexts
 * where HttpOnly cookies are blocked by the browser (Chrome 80+ third-party
 * cookie blocking).
 *
 * Security model:
 *   - Requires an authenticated session (cookie or existing bearer).
 *   - The returned token is stored ONLY in page memory (not localStorage).
 *   - 5-minute TTL — if the iframe reloads, it requests a fresh token.
 *   - Only one iframe token is valid per session (rotation on each request).
 *   - Rate-limited: 10/minute per IP (an iframe typically needs one token).
 *
 * WHY NOT localStorage:
 *   Storing bearer tokens in localStorage exposes them to any XSS attack.
 *   A single XSS → full account takeover including all financial operations.
 *   In-memory tokens are lost on page unload, limiting the attack window to
 *   the lifetime of the XSS payload (typically milliseconds).
 */

export async function POST(req: Request) {
  const limited = await rateLimit(req, { key: "iframe-token", limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  let user: Awaited<ReturnType<typeof requireUser>>;
  let session: any;
  try {
    // requireUser validates the session cookie or bearer token.
    // We need the session ID to issue the iframe token, so we look it up.
    user = await requireUser();
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  // Find the current session to get its ID for iframe token issuance.
  const { cookies: getCookieStore } = await import("next/headers");
  const cookieStore = await getCookieStore();
  const sessionToken = cookieStore.get("tp_session")?.value;

  if (sessionToken) {
    // Cookie-based session — find by access token hash.
    const { hashToken } = await import("@/lib/turbopay/crypto");
    const tokenHash = hashToken(sessionToken);
    session = await db.session.findUnique({ where: { tokenHash }, select: { id: true } });
  }

  if (!session) {
    // Bearer-based session — find by bearer token hash.
    const authHeader = req.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const { hashToken } = await import("@/lib/turbopay/crypto");
      const tokenHash = hashToken(authHeader.slice(7).trim());
      session = await db.session.findUnique({ where: { tokenHash }, select: { id: true } });
    }
  }

  if (!session) {
    return errorJson("Session not found", 401, "SESSION_NOT_FOUND");
  }

  const iframeToken = await createIframeToken(session.id);

  await audit({
    userId: user.id,
    action: "IFRAME_TOKEN_ISSUED",
    category: "AUTH",
    severity: "INFO",
    ip: readIp(req.headers),
    metadata: { sessionId: session.id },
  });

  return json({
    data: {
      iframeToken,
      expiresIn: 300, // 5 minutes in seconds
    },
  });
}
