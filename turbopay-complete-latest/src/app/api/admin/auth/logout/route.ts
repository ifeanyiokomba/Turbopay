import { NextRequest, NextResponse } from "next/server";
import { logout } from "@/lib/turbopay/auth";

export async function POST(req: NextRequest) {
  // Revoke the session server-side (DB + cookies). If the session cannot be
  // identified (e.g. cookie already cleared), logout() still clears all cookies.
  try {
    await logout();
  } catch {
    // Best-effort: even if DB revocation fails, clear cookies so the browser
    // stops sending the token. The DB session will expire naturally (24h TTL).
  }
  const response = NextResponse.json({ success: true });
  response.cookies.set("admin_session", "", { maxAge: 0, path: "/" });
  response.cookies.set("tp_session", "", { maxAge: 0, path: "/" });
  return response;
}
