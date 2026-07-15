import { db } from "@/lib/db";
import { requireUser, readIp, regenerateAccessToken } from "@/lib/turbopay/auth";
import { hashPin, verifyPin, hashToken } from "@/lib/turbopay/crypto";
import { audit } from "@/lib/turbopay/audit";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { cookies } from "next/headers";
import { z } from "zod";

const schema = z.object({
  pin: z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits"),
  currentPin: z.string().regex(/^\d{4}$/).optional(),
});

/**
 * Reject weak PINs — sequential (1234, 4321), repeated (0000, 1111), or
 * commonly-guessed patterns. These are the first things an attacker tries.
 */
const WEAK_PINS = new Set([
  "0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999",
  "1234", "4321", "0123", "3210", "1357", "2468", "9876", "6543",
  "1990", "1991", "1992", "1993", "1994", "1995", "1996", "1997", "1998", "1999",
  "2000", "2001", "2002", "2003", "2004", "2005", "2006", "2007", "2008", "2009",
  "2010", "2011", "2012", "2013", "2014", "2015", "2016", "2017", "2018", "2019",
  "2020", "2021", "2022", "2023", "2024", "2025",
]);

function isWeakPin(pin: string): boolean {
  if (WEAK_PINS.has(pin)) return true;
  // Sequential: each digit +1 from the previous (1234, 2345, etc.)
  const sequential = "0123456789";
  if (sequential.includes(pin)) return true;
  if (sequential.split("").reverse().join("").includes(pin)) return true;
  return false;
}

/**
 * Set (or change) the transaction PIN. If a PIN is already set, the caller
 * must supply `currentPin` to authorise the change. The PIN is scrypt-hashed
 * before storage — a DB leak never exposes raw PINs.
 */
export async function POST(req: Request) {
  // Rate limit: 5 PIN-set attempts per 10 minutes per IP.
  const limited = await rateLimit(req, { key: "set-pin", limit: 5, windowMs: 10 * 60 * 1000 });
  if (limited) return limited;

  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid request body", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid input", 422, "VALIDATION");

  const { pin, currentPin } = parsed.data;

  // Reject weak PINs (sequential, repeated, common patterns).
  if (isWeakPin(pin)) {
    return errorJson("That PIN is too common. Choose a less predictable 4-digit PIN.", 400, "WEAK_PIN");
  }

  const dbUser = await db.user.findUnique({ where: { id: user.id }, select: { transactionPinHash: true } });
  if (dbUser?.transactionPinHash) {
    // Changing an existing PIN requires the current PIN.
    if (!currentPin) return errorJson("Current PIN is required to change your PIN", 400, "CURRENT_PIN_REQUIRED");
    if (!verifyPin(currentPin, dbUser.transactionPinHash)) {
      await audit({ userId: user.id, action: "PIN_CHANGE_FAILED", category: "AUTH", severity: "WARN", ip: readIp(req.headers) });
      return errorJson("Current PIN is incorrect", 400, "INVALID_CURRENT_PIN");
    }
  }

  await db.user.update({
    where: { id: user.id },
    data: { transactionPinHash: hashPin(pin), pinSetAt: new Date() },
  });
  await audit({ userId: user.id, action: "PIN_SET", category: "AUTH", severity: "INFO", ip: readIp(req.headers) });

  // ── Session rotation ────────────────────────────────────────
  // After a PIN set/change, rotate the current session's access token so
  // the previous token (which may have been observed by an attacker who
  // intercepted the request, e.g. via a logged Authorization header) can't
  // be replayed to authorize subsequent debits. The refresh token is left
  // untouched (the user can still refresh without re-authenticating). The
  // new access token is returned so the client can update its localStorage
  // copy — otherwise its next request would 401 (stale token) and trigger
  // an unnecessary refresh round-trip.
  //
  // The session ID isn't carried by `requireUser()` (it returns a
  // SessionUser without the sessionId), so we look up the current session
  // row from the cookie token hash — same pattern as the password-change
  // route.
  let newSessionToken: string | undefined;
  try {
    const cookieStore = await cookies();
    const rawToken = cookieStore.get("tp_session")?.value ?? "";
    const currentTokenHash = rawToken ? hashToken(rawToken) : null;
    if (currentTokenHash) {
      const currentSession = await db.session.findUnique({
        where: { tokenHash: currentTokenHash },
        select: { id: true, revokedAt: true },
      });
      if (currentSession && !currentSession.revokedAt) {
        newSessionToken = await regenerateAccessToken(currentSession.id);
      }
    }
  } catch {
    // Cookie/session lookup is best-effort. If it fails (e.g. the request
    // came via Bearer header without a cookie), the PIN was still set —
    // we just don't rotate. The user can continue with their existing
    // token until it expires.
  }

  return json({
    data: {
      ok: true,
      hasPin: true,
      // SECURITY: The rotated access token is set as an HttpOnly cookie by
      // regenerateAccessToken(). The client never sees the token value.
    },
  });
}

/**
 * Verify the transaction PIN. Used by the frontend before submitting a debit
 * (transfer, airtime, data, bills). Returns 200 on success, 400 on wrong PIN.
 * Rate-limited to 10 attempts/10min to resist brute force (10^4 = 10000 combos).
 */
const verifySchema = z.object({ pin: z.string().regex(/^\d{4}$/) });

export async function PUT(req: Request) {
  const limited = await rateLimit(req, { key: "verify-pin", limit: 10, windowMs: 10 * 60 * 1000 });
  if (limited) return limited;

  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid request body", 400);
  }
  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid input", 422, "VALIDATION");

  const dbUser = await db.user.findUnique({ where: { id: user.id }, select: { transactionPinHash: true } });
  if (!dbUser?.transactionPinHash) {
    return errorJson("No transaction PIN set. Please set one first.", 400, "PIN_NOT_SET");
  }
  const ok = verifyPin(parsed.data.pin, dbUser.transactionPinHash);
  if (!ok) {
    await audit({ userId: user.id, action: "PIN_VERIFY_FAILED", category: "AUTH", severity: "WARN", ip: readIp(req.headers) });
    return errorJson("Incorrect PIN", 400, "INVALID_PIN");
  }
  return json({ data: { ok: true } });
}
