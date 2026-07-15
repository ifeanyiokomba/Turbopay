import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const response = NextResponse.json({ success: true });
  response.cookies.set("admin_session", "", { maxAge: 0, path: "/" });
  response.cookies.set("tp_session", "", { maxAge: 0, path: "/" });
  return response;
}
