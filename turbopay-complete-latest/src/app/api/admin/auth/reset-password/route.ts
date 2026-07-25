import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, hashOtp } from "@/lib/turbopay/crypto";
import { rateLimit } from "@/lib/turbopay/rate-limit";

export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, { key: "admin-reset-password", limit: 5, windowMs: 15 * 60 * 1000 });
  if (limited) return limited;

  try {
    const { code, password } = await req.json();
    if (!code || !password) {
      return NextResponse.json({ error: "Code and password required" }, { status: 400 });
    }

    // Find the most recent unconsumed token for this purpose (code is now hashed).
    const recoveryToken = await db.recoveryToken.findFirst({
      where: { purpose: "RESET_PASSWORD", expiresAt: { gt: new Date() }, consumed: false },
      orderBy: { createdAt: "desc" },
    });

    if (!recoveryToken || !recoveryToken.code) {
      return NextResponse.json({ error: "Invalid or expired code" }, { status: 400 });
    }

    // Verify the hashed code matches
    const hashedInput = hashOtp(code);
    if (hashedInput !== recoveryToken.code) {
      return NextResponse.json({ error: "Invalid or expired code" }, { status: 400 });
    }

    const passwordHash = hashPassword(password);
    await db.user.update({ where: { id: recoveryToken.userId }, data: { passwordHash } });
    await db.recoveryToken.update({ where: { id: recoveryToken.id }, data: { consumed: true } });
    await db.session.deleteMany({ where: { userId: recoveryToken.userId } });

    return NextResponse.json({ message: "Password reset successfully" });
  } catch (error) {
    console.error("[Reset Password Error]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
