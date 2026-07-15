import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createSession } from "@/lib/turbopay/auth";
import { verifyPassword } from "@/lib/turbopay/crypto";

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }

    const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    if (user.role !== "ADMIN") {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    if (user.status !== "ACTIVE") {
      return NextResponse.json({ error: "Account is disabled" }, { status: 403 });
    }

    if (!user.passwordHash) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const valid = verifyPassword(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
    const session = await createSession(user.id, { ip });

    const response = NextResponse.json({
      user: { id: user.id, email: user.email, role: user.role, fullName: user.fullName }
    });

    response.cookies.set("admin_session", session.sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60,
      path: "/"
    });

    return response;
  } catch (error) {
    console.error("[Admin Login Error]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
