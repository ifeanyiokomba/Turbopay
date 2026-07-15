import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/turbopay/auth";
import { z } from "zod";

const prefsSchema = z.object({
  transactionAlerts: z.boolean().optional(),
  securityAlerts: z.boolean().optional(),
  promotional: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
  smsEnabled: z.boolean().optional(),
});

/**
 * GET /api/profile/notifications — get notification preferences
 */
export async function GET() {
  try {
    const sessionUser = await requireUser();
    const prefs = await db.communicationPreference.findUnique({
      where: { userId: sessionUser.id },
    });
    return NextResponse.json(prefs ?? {
      transactionAlerts: true,
      securityAlerts: true,
      promotional: false,
      emailEnabled: true,
      smsEnabled: true,
    });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

/**
 * PATCH /api/profile/notifications — update notification preferences
 */
export async function PATCH(req: NextRequest) {
  try {
    const sessionUser = await requireUser();
    const body = await req.json();
    const parsed = prefsSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const prefs = await db.communicationPreference.upsert({
      where: { userId: sessionUser.id },
      create: { userId: sessionUser.id, ...parsed.data },
      update: parsed.data,
    });

    return NextResponse.json(prefs);
  } catch (e: any) {
    if (e?.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[Notification Prefs Error]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
