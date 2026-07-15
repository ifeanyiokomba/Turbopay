import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/turbopay/crypto";

export async function POST(req: NextRequest) {
  try {
    const { code, password } = await req.json();
    if (!code || !password) {
      return NextResponse.json({ error: "Code and password required" }, { status: 400 });
    }

    const recoveryToken = await db.recoveryToken.findFirst({
      where: { code, purpose: "RESET_PASSWORD", expiresAt: { gt: new Date() }, consumed: false },
    });

    if (!recoveryToken) {
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
