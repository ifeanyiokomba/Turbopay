import { readIp } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { authService } from "@/lib/turbopay/services/auth.service";
import { ServiceError } from "@/lib/turbopay/services/types";
import { z } from "zod";
import { cookies } from "next/headers";

const schema = z.object({
  identifier: z.string().min(3, "Enter your email, phone, or username"),
  password: z.string().min(1, "Enter your password"),
});

export async function POST(req: Request) {
  try {
    // Layer 1: per-IP rate limit
    const ipLimited = await rateLimit(req, { key: "login", limit: 10, windowMs: 60_000 });
    if (ipLimited) return ipLimited;

    let body: unknown;
    try { body = await req.json(); } catch { return errorJson("Invalid request body", 400); }
    const parsed = schema.safeParse(body);
    if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid input", 422, "VALIDATION");

    // Layer 2: per-identifier rate limit
    const id = parsed.data.identifier.trim().toLowerCase();
    const idLimited = await rateLimit(req, { key: "login-user", limit: 10, windowMs: 15 * 60 * 1000, identifier: id });
    if (idLimited) return idLimited;

    const ip = readIp(req.headers);
    const userAgent = req.headers.get("user-agent") ?? undefined;

    const result = await authService.login({
      identifier: parsed.data.identifier,
      password: parsed.data.password,
      ip: ip ?? undefined,
      userAgent,
    });

    // Handle MFA challenge (no session tokens yet)
    if (result.mfaRequired) {
      return json({ data: { mfaRequired: true, userId: result.user.id, hasBackupCodes: result.hasBackupCodes } });
    }

    // Set refresh token as HttpOnly cookie
    const c = await cookies();
    const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    c.set("tp_refresh", result.refreshToken, {
      httpOnly: true,
      sameSite: process.env.NODE_ENV === "production" ? "lax" : "none",
      path: "/api/auth/refresh",
      expires: refreshExpiresAt,
      secure: true,
    });

    return json({ data: result.user });
  } catch (error: any) {
    if (error instanceof ServiceError) {
      const headers: Record<string, string> = {};
      if (error.code === "ACCOUNT_LOCKED") headers["Retry-After"] = "900";
      return errorJson(error.message, error.status, error.code, undefined, headers);
    }
    console.error("[User Login Error]", { message: error?.message, code: error?.code });
    return errorJson("Internal server error", 500);
  }
}
