import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/turbopay/auth";

export async function GET() {
  try {
    const user = await requireAdmin();
    return NextResponse.json({
      user: { id: user.id, email: user.email, role: user.role, fullName: user.fullName }
    });
  } catch {
    return NextResponse.json({ user: null }, { status: 401 });
  }
}
