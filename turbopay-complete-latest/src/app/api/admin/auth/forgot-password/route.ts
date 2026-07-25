import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashOtp } from "@/lib/turbopay/crypto";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, { key: "admin-forgot-password", limit: 5, windowMs: 60 * 60 * 1000 });
  if (limited) return limited;

  try {
    const { email } = await req.json();
    if (!email) {
      return NextResponse.json({ error: "Email required" }, { status: 400 });
    }

    const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) {
      return NextResponse.json({ message: "If an account exists, a reset link has been sent." });
    }

    const code = crypto.randomInt(100000, 999999).toString();
    const expires = new Date(Date.now() + 60 * 60 * 1000);

    await db.recoveryToken.create({
      data: {
        userId: user.id,
        code: hashOtp(code),
        purpose: "RESET_PASSWORD",
        channel: "EMAIL",
        target: email.toLowerCase(),
        expiresAt: expires,
      },
    });

    if (process.env.NODE_ENV !== "production") {
      console.log(`[Password Reset] Code for ${email}: ${code} (dev only)`);
    }
    return NextResponse.json({ message: "If an account exists, a reset link has been sent." });
  } catch (error) {
    console.error("[Forgot Password Error]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
